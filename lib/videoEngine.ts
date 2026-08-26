import { RenderConfig, SubtitleCue } from "@/types";

// Engaño a Safari: 1x1 píxel en vez de desaparecerlo, para no bloquear el render
const INVISIBLE_CSS = "position:fixed;top:0;left:0;width:1px;height:1px;z-index:-100;pointer-events:none;";

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress } = config;
  
  // MODO SUPERVIVENCIA: Resolución bajísima. Escala perfectamente en TikTok pero
  // gasta un 90% menos de memoria RAM en tu móvil.
  const width = 270;
  const height = 480;
  const FPS = 12; // 12 FPS es suficiente para vídeos virales rápidos sin quemar la CPU
  const frameTime = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width; 
  canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;

  // Audio ultra-seguro (Si el móvil se queja de RAM, renderiza sin sonido en vez de crashear)
  let dest = null;
  let audioCtx = null;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
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
  } catch (e) {
    console.warn("Audio desactivado temporalmente para proteger la RAM del dispositivo.");
  }

  const canvasStream = canvas.captureStream(FPS);
  const tracks = [...canvasStream.getVideoTracks()];
  if (dest) tracks.push(...dest.stream.getAudioTracks());
  const combinedStream = new MediaStream(tracks);
  
  let mime = "";
  const isApple = /iPhone|iPad|iPod|Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
  
  if (isApple && MediaRecorder.isTypeSupported("video/mp4")) {
    mime = "video/mp4";
  } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    mime = "video/webm;codecs=vp8";
  } else {
    mime = "video/webm"; // Red de seguridad
  }
  
  // Bitrate MÍNIMO (500 Kbps) para que los chunks de vídeo sean microscópicos
  const recorder = new MediaRecorder(combinedStream, { 
    mimeType: mime,
    videoBitsPerSecond: 500000 
  });
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let currentClipIdx = -1;
    let activeVideo: HTMLVideoElement | null = null;
    const clipDur = targetDuration / clips.length;

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
      // IMPORTANTE: Hemos quitado "crossOrigin = anonymous" porque en iOS causa bloqueos de seguridad con vídeos de la galería
      document.body.appendChild(activeVideo);
      
      await new Promise<void>(res => { 
        if (!activeVideo) return res();
        activeVideo.oncanplay = () => res(); 
        setTimeout(res, 500); // 0.5 seg de tiempo máximo. Si tarda más, forzamos inicio.
      });
      
      activeVideo.play().catch(()=>{});
    };

    recorder.onstop = () => {
      tracks.forEach(t => t.stop());
      if (activeVideo) {
        activeVideo.removeAttribute("src");
        activeVideo.remove();
      }
      canvas.width = 0; canvas.height = 0; // Obliga al GC a limpiar la RAM de gráficos
      canvas.remove();
      try { audioCtx?.close(); } catch(e){}

      if (chunks.length === 0) reject(new Error("El navegador detuvo la grabación."));
      else resolve(URL.createObjectURL(new Blob(chunks, { type: mime || "video/mp4" })));
    };

    recorder.onerror = () => reject(new Error("MediaRecorder falló."));

    recorder.start(2000); // Tiempos grandes de chunk para evitar sobrecarga de procesador
    const start = performance.now();
    await loadVideo(0);
    currentClipIdx = 0;

    const drawLoop = async () => {
      if (isFinished) return;
      const elapsed = (performance.now() - start) / 1000;
      onProgress(Math.min(100, (elapsed / targetDuration) * 100));

      if (elapsed >= targetDuration) {
        isFinished = true;
        recorder.stop();
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

      // Subtítulos
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
    
    setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        recorder.stop();
      }
    }, (targetDuration + 2) * 1000);
  });
}
