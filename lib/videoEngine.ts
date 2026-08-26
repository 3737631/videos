import { RenderConfig, SubtitleCue } from "@/types";

const INVISIBLE_CSS = "position:fixed;top:0;left:0;width:1px;height:1px;z-index:-100;pointer-events:none;";

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress } = config;
  
  const width = 270;
  const height = 480;
  const FPS = 12; 
  const frameTime = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width; 
  canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Tu navegador no permite gráficos 2D.");

  // Forzamos pintar un frame negro de inicio para que captureStream detecte actividad
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let dest = null;
  let audioCtx = null;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      dest = audioCtx.createMediaStreamDestination();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      if (audioBlob) {
        const ab = await audioBlob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(ab);
        const src = audioCtx.createBufferSource();
        src.buffer = decoded;
        src.connect(dest);
        src.start(0);
      }
    }
  } catch (e) {
    console.warn("Módulo de Audio bloqueado, continuando sin él.");
  }

  // Capturador blindado
  const captureStreamFunc = canvas.captureStream || (canvas as any).mozCaptureStream || (canvas as any).webkitCaptureStream;
  if (!captureStreamFunc) throw new Error("Tu navegador no soporta grabación de Canvas (Prueba en Chrome o Safari modernos).");
  
  const canvasStream = captureStreamFunc.call(canvas, FPS);
  const tracks = [...canvasStream.getVideoTracks()];
  if (dest) tracks.push(...dest.stream.getAudioTracks());
  const combinedStream = new MediaStream(tracks);
  
  // VERIFICADOR DE FORMATOS DEFENSIVO
  const isApple = /iPhone|iPad|iPod|Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
  const checkMime = (t: string) => { try { return MediaRecorder.isTypeSupported?.(t); } catch { return false; } };
  
  let mime = "";
  if (isApple && checkMime("video/mp4")) mime = "video/mp4";
  else if (checkMime("video/webm;codecs=vp8")) mime = "video/webm;codecs=vp8";
  else if (checkMime("video/webm")) mime = "video/webm";

  let recorder: MediaRecorder;
  try {
    // Intento 1: Con compresión ajustada
    recorder = mime 
      ? new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 500000 }) 
      : new MediaRecorder(combinedStream, { videoBitsPerSecond: 500000 });
  } catch (err1) {
    try {
      // Intento 2: Fallback genérico sin ajustar compresión (Salva crasheos en ordenadores viejos)
      recorder = new MediaRecorder(combinedStream);
    } catch (err2) {
      throw new Error("Tu navegador actual bloquea la grabación de vídeo. Intenta usar Google Chrome.");
    }
  }
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let isResolved = false; 
    let currentClipIdx = -1;
    let activeVideo: HTMLVideoElement | null = null;
    const clipDur = targetDuration / clips.length;

    const finalize = () => {
      if (isResolved) return;
      isResolved = true; 

      tracks.forEach(t => t.stop());
      if (activeVideo) {
        activeVideo.removeAttribute("src");
        activeVideo.remove();
      }
      setTimeout(() => { canvas.width = 0; canvas.remove(); }, 200);
      try { audioCtx?.close(); } catch(e){}

      if (chunks.length === 0) {
        reject(new Error("No se procesó ningún fotograma de vídeo."));
      } else {
        resolve(URL.createObjectURL(new Blob(chunks, { type: mime || "video/mp4" })));
      }
    };

    const stopRecording = () => {
      if (isFinished) return;
      isFinished = true;
      
      try {
        if (recorder.state !== "inactive") {
          try { recorder.requestData(); } catch(e){} // Protegido contra bloqueos de estado
          try { recorder.stop(); } catch(e){}
        }
      } catch(e){}
      
      setTimeout(finalize, 1000);
    };

    const loadVideo = async (index: number) => {
      if (activeVideo) {
        activeVideo.pause();
        activeVideo.removeAttribute("src");
        activeVideo.load();
        activeVideo.remove();
        activeVideo = null;
      }
      if (index >= clips.length) return;

      activeVideo = document.createElement("video");
      activeVideo.src = clips[index].url;
      activeVideo.muted = true;
      activeVideo.playsInline = true;
      activeVideo.style.cssText = INVISIBLE_CSS;
      document.body.appendChild(activeVideo);
      
      await new Promise<void>(res => { 
        if (!activeVideo) return res();
        activeVideo.oncanplay = () => res(); 
        setTimeout(res, 500); 
      });
      activeVideo.play().catch(()=>{});
    };

    recorder.onstop = finalize;
    recorder.onerror = () => reject(new Error("La grabación colapsó internamente."));

    recorder.start(1000); 
    const start = performance.now();
    await loadVideo(0);
    currentClipIdx = 0;

    const drawLoop = async () => {
      if (isFinished) return;
      
      const elapsed = (performance.now() - start) / 1000;
      onProgress(Math.min(100, (elapsed / targetDuration) * 100));

      if (elapsed >= targetDuration) {
        stopRecording();
        return;
      }

      const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
      if (activeIdx !== currentClipIdx) {
        currentClipIdx = activeIdx;
        await loadVideo(currentClipIdx);
      }

      ctx.fillStyle = "#000000"; 
      ctx.fillRect(0, 0, width, height);
      
      if (activeVideo && activeVideo.readyState >= 2) {
        const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
        const dw = activeVideo.videoWidth * scale;
        const dh = activeVideo.videoHeight * scale;
        ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
      if (cue) {
        ctx.font = '900 20px "Inter", sans-serif'; 
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const txt = cue.text;
        const y = height * 0.75;
        
        ctx.lineWidth = 3; 
        ctx.strokeStyle = "#000";
        ctx.strokeText(txt, width / 2, y);
        ctx.fillStyle = "#FFE600";
        ctx.fillText(txt, width / 2, y);
      }

      setTimeout(drawLoop, frameTime);
    };
    
    drawLoop();
    setTimeout(stopRecording, (targetDuration + 2) * 1000);
  });
}
