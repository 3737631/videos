import { RenderConfig } from "@/types";

const INVISIBLE_CSS = "position:fixed;top:0;left:-9999px;width:270px;height:480px;z-index:-100;pointer-events:none;";

// Añadimos wordChunks a la interfaz extendida para recibir las palabras
interface ExtendedRenderConfig extends RenderConfig {
  wordChunks?: string[];
}

export async function renderFinalVideo(config: ExtendedRenderConfig): Promise<string> {
  const { clips, audioBlob, wordChunks, mode } = config;
  
  const width = 270;
  const height = 480;
  const FPS = 30; 
  const frameInterval = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Tu navegador no soporta Canvas 2D.");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AC();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();

  // Mantenemos un sonido inaudible continuo para que el grabador nunca corte la pista de audio
  const osc = audioCtx.createOscillator();
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0.01; 
  osc.connect(silentGain);
  silentGain.connect(dest);
  osc.start();

  let actualDuration = config.targetDuration;
  let dynamicCues: {text: string, start: number, end: number}[] = [];

  // DECODIFICAR AUDIO Y SINCRONIZAR TIEMPOS
  if (audioBlob) {
    try {
      const ab = await audioBlob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(ab);
      
      // EL TRUCO MAGISTRAL: El vídeo durará EXACTAMENTE lo que dure la voz
      actualDuration = decoded.duration; 

      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(dest);
      source.start(0);

      if (mode === "voice" && wordChunks) {
        // Repartimos los subtítulos de forma matemáticamente perfecta a lo largo del audio
        const timePerChunk = actualDuration / wordChunks.length;
        wordChunks.forEach((text, i) => {
          dynamicCues.push({
            text: text.toUpperCase(),
            start: i * timePerChunk,
            end: (i + 1) * timePerChunk
          });
        });
      }
    } catch (e) {
      console.warn("Fallo al decodificar audio, procediendo en silencio.");
    }
  }

  const captureStreamFunc = canvas.captureStream || (canvas as any).mozCaptureStream || (canvas as any).webkitCaptureStream;
  const canvasStream = captureStreamFunc.call(canvas, FPS);
  const combinedStream = new MediaStream([ ...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks() ]);
  
  const isApple = /iPhone|iPad|iPod|Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
  const checkMime = (t: string) => { try { return MediaRecorder.isTypeSupported?.(t); } catch { return false; } };
  
  let mime = "";
  if (isApple && checkMime("video/mp4")) mime = "video/mp4";
  else if (checkMime("video/webm;codecs=vp8,opus")) mime = "video/webm;codecs=vp8,opus";
  else if (checkMime("video/webm;codecs=vp8")) mime = "video/webm;codecs=vp8";
  else mime = "video/webm";

  let recorder: MediaRecorder;
  try {
    recorder = mime ? new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 1000000 }) : new MediaRecorder(combinedStream);
  } catch (err) {
    recorder = new MediaRecorder(combinedStream);
  }
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let currentClipIdx = -1;
    let activeVideo: HTMLVideoElement | null = null;
    let lastDrawTime = performance.now();
    let frameId = 0;
    
    // Calcular cuánto debe durar cada corte de vídeo basándonos en la duración real del audio
    const clipDur = actualDuration / clips.length;

    const finalize = () => {
      cancelAnimationFrame(frameId);
      if (activeVideo) { activeVideo.removeAttribute("src"); activeVideo.remove(); }
      setTimeout(() => { canvas.width = 0; canvas.remove(); }, 200);
      try { audioCtx.close(); } catch(e){}
      
      if (chunks.length === 0) reject(new Error("No se procesó vídeo."));
      else resolve(URL.createObjectURL(new Blob(chunks, { type: mime || "video/mp4" })));
    };

    const stopRecording = () => {
      if (isFinished) return;
      isFinished = true;
      try { if (recorder.state !== "inactive") recorder.stop(); } catch(e){}
      setTimeout(finalize, 1000); 
    };

    const loadVideoAsync = async (index: number) => {
      if (index >= clips.length) return;
      const newVideo = document.createElement("video");
      newVideo.src = clips[index].url;
      // Empieza a reproducir el vídeo en una parte aleatoria para que siempre haya movimiento
      newVideo.currentTime = Math.random() * (clips[index].playDuration * 0.5); 
      newVideo.muted = true;
      newVideo.playsInline = true;
      newVideo.style.cssText = INVISIBLE_CSS;
      document.body.appendChild(newVideo);
      
      await new Promise<void>(res => { newVideo.oncanplay = () => res(); setTimeout(res, 400); });
      newVideo.play().catch(()=>{});

      const oldVideo = activeVideo;
      activeVideo = newVideo;
      if (oldVideo) { oldVideo.pause(); oldVideo.removeAttribute("src"); oldVideo.remove(); }
    };

    recorder.onstop = finalize;
    recorder.onerror = () => reject(new Error("Error interno al grabar."));

    recorder.start(250); 
    const start = performance.now();
    
    currentClipIdx = 0;
    await loadVideoAsync(0);

    const drawLoop = () => {
      if (isFinished) return;
      frameId = requestAnimationFrame(drawLoop); 
      
      const now = performance.now();
      const delta = now - lastDrawTime;

      if (delta >= frameInterval) {
        lastDrawTime = now - (delta % frameInterval);
        const elapsed = (now - start) / 1000;
        config.onProgress(Math.min(100, (elapsed / actualDuration) * 100));

        if (elapsed >= actualDuration) {
          stopRecording();
          return;
        }

        const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
        if (activeIdx !== currentClipIdx) {
          currentClipIdx = activeIdx;
          loadVideoAsync(currentClipIdx); 
        }

        if (activeVideo && activeVideo.readyState >= 2) {
          ctx.fillStyle = "#000000"; 
          ctx.fillRect(0, 0, width, height);
          const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
          const dw = activeVideo.videoWidth * scale;
          const dh = activeVideo.videoHeight * scale;
          ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
        }

        // SUBTÍTULOS 100% ESTILO TIKTOK: Centrados, grandes y con tope máximo de ancho
        if (mode === "voice") {
          const cue = dynamicCues.find(c => elapsed >= c.start && elapsed <= c.end);
          if (cue) {
            ctx.font = '900 36px "Inter", "Arial", sans-serif'; 
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.lineWidth = 6; 
            ctx.strokeStyle = "#000000";
            ctx.fillStyle = "#FFE600"; // Amarillo viral
            
            // Sombra para dar volumen y aspecto profesional
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            
            // Se dibuja JUSTO EN EL CENTRO EXACTO (width / 2, height / 2)
            // Y el maxWidth (width - 30) hace que se encojan automáticamente si son muy largos
            ctx.strokeText(cue.text, width / 2, height / 2, width - 30);
            
            ctx.shadowBlur = 0; // Desactivar sombra para el relleno
            ctx.shadowOffsetY = 0;
            ctx.fillText(cue.text, width / 2, height / 2, width - 30);
          }
        }
      }
    };
    
    drawLoop();
    setTimeout(stopRecording, (actualDuration + 2) * 1000);
  });
}
