import { RenderConfig } from "@/types";

const INVISIBLE_CSS = "position:fixed;top:0;left:-9999px;width:270px;height:480px;z-index:-100;pointer-events:none;";

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

  let dest: MediaStreamAudioDestinationNode | null = null;
  let audioCtx: AudioContext | null = null;
  let actualDuration = config.targetDuration || 10;
  let dynamicCues: {text: string, start: number, end: number}[] = [];

  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      dest = audioCtx.createMediaStreamDestination();

      // Oscilador de fondo (inperceptible) para forzar que el grabador de audio no se duerma
      const osc = audioCtx.createOscillator();
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0.01; 
      osc.connect(silentGain);
      silentGain.connect(dest);
      osc.start();

      if (audioBlob) {
        const ab = await audioBlob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(ab);
        
        // El vídeo dura exactamente lo mismo que el audio (Cero silencios)
        if (decoded.duration > 0 && !isNaN(decoded.duration)) {
            actualDuration = decoded.duration;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        
        if (mode === "voice" && wordChunks) {
          // Acelerador Viral para la voz (máximo 1.25x)
          source.playbackRate.value = 1.15;
          actualDuration = actualDuration / 1.15;

          // Repartimos los subtítulos por el audio
          const timePerChunk = actualDuration / wordChunks.length;
          wordChunks.forEach((text, i) => {
            dynamicCues.push({
              text: text.toUpperCase(),
              start: i * timePerChunk,
              end: (i + 1) * timePerChunk
            });
          });
        } else {
          source.loop = true; // Loop para música
        }

        source.connect(dest);
        source.start(0);
      }
    }
  } catch (e) {
    console.error("Audio desactivado:", e);
  }

  const captureStreamFunc = canvas.captureStream || (canvas as any).mozCaptureStream || (canvas as any).webkitCaptureStream;
  const canvasStream = captureStreamFunc.call(canvas, FPS);
  const tracks = [...canvasStream.getVideoTracks()];
  if (dest) tracks.push(...dest.stream.getAudioTracks());
  const combinedStream = new MediaStream(tracks);
  
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
    
    const clipDur = actualDuration / clips.length;

    const finalize = () => {
      cancelAnimationFrame(frameId);
      if (activeVideo) { activeVideo.removeAttribute("src"); activeVideo.remove(); }
      setTimeout(() => { canvas.width = 0; canvas.remove(); }, 200);
      try { audioCtx?.close(); } catch(e){}
      
      if (chunks.length === 0) reject(new Error("No se procesó el vídeo (Cero fotogramas)."));
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
      // Inicia el clip aleatoriamente para evadir partes aburridas
      newVideo.currentTime = Math.random() * Math.max(0, clips[index].playDuration - clipDur); 
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
    recorder.onerror = () => reject(new Error("Error al grabar el vídeo."));

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

        // Pintado de pantalla
        ctx.fillStyle = "#000000"; 
        ctx.fillRect(0, 0, width, height);

        if (activeVideo && activeVideo.readyState >= 2) {
          const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
          const dw = activeVideo.videoWidth * scale;
          const dh = activeVideo.videoHeight * scale;
          ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
        }

        // SUBTÍTULOS PERFECTOS
        if (mode === "voice") {
          const cue = dynamicCues.find(c => elapsed >= c.start && elapsed <= c.end);
          if (cue) {
            ctx.font = '900 34px "Inter", "Arial", sans-serif'; 
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.lineWidth = 6; 
            ctx.strokeStyle = "#000000";
            ctx.fillStyle = "#FFE600"; 
            
            // CENTRO EXACTO
            const textX = width / 2;
            const textY = height / 2;
            const maxWidth = width - 40; // 20px de margen a cada lado
            
            ctx.strokeText(cue.text, textX, textY, maxWidth);
            ctx.fillText(cue.text, textX, textY, maxWidth);
          }
        }
      }
    };
    
    drawLoop();
    setTimeout(stopRecording, (actualDuration + 2) * 1000); // Failsafe
  });
}
