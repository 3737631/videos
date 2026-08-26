import { RenderConfig, SubtitleCue } from "@/types";

const IS_APPLE = typeof navigator !== "undefined" && 
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || /^((?!chrome|android).)*safari/i.test(navigator.userAgent));

const INVISIBLE_CSS = "position:fixed;left:-9999px;top:0;width:300px;height:300px;opacity:1;pointer-events:none;z-index:9999;";

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress } = config;
  
  // SOLUCIÓN ANTI-CRASH (OOM): Reducimos a 540x960 (qHD). 
  // Se ve perfecto en TikTok pero usa la MITAD de memoria RAM que 720x1280.
  const width = 540;
  const height = 960;
  // Reducimos a 25 FPS (Formato cine). Ahorra un 15% extra de memoria.
  const FPS = 25; 
  const fpsInterval = 1000 / FPS; 

  const canvas = document.createElement("canvas");
  canvas.width = width; 
  canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  // willReadFrequently: true ayuda a los móviles a no saturar la GPU compartida
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;

  const AC = window.AudioContext || (window as any).webkitAudioContext;
  let audioCtx = new AC();
  let dest = audioCtx.createMediaStreamDestination();

  if (audioCtx.state === "suspended") {
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
    await audioCtx.resume();
  }

  if (audioBlob) {
    try {
      const ab = await audioBlob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(ab);
      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(dest);
      source.start(0);
    } catch (e) {
      console.warn("Audio ignorado por falta de memoria.");
    }
  }

  const canvasStream = canvas.captureStream(FPS);
  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(tracks);
  
  const mime = IS_APPLE ? "video/mp4" : "video/webm";
  
  // Bitrate ligero adaptado a la nueva resolución (1.2 Mbps)
  const recorder = new MediaRecorder(combinedStream, { 
    mimeType: mime,
    videoBitsPerSecond: 1200000 
  });
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let frameId = 0;
    let isFinished = false;
    let currentClipIdx = -1;
    let activeVideoEl: HTMLVideoElement | null = null;
    let lastDrawTime = performance.now();
    
    const clipDur = targetDuration / clips.length;

    // CARGA DESTRUCTIVA: Borra totalmente el rastro del vídeo anterior de la RAM
    const loadVideo = async (index: number) => {
      if (activeVideoEl) {
        activeVideoEl.pause();
        activeVideoEl.src = ""; // Liberación agresiva
        activeVideoEl.load();
        activeVideoEl.remove();
        activeVideoEl = null;
      }

      if (index >= clips.length) return null;

      const v = document.createElement("video");
      v.src = clips[index].url;
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.style.cssText = INVISIBLE_CSS;
      document.body.appendChild(v);
      
      await new Promise<void>(res => { 
        v.onloadeddata = () => res(); 
        setTimeout(res, 2000); 
      });
      
      v.play().catch(()=>{});
      activeVideoEl = v;
      return v;
    };

    recorder.onstop = () => {
      cancelAnimationFrame(frameId);
      tracks.forEach(t => t.stop());
      if (activeVideoEl) {
        activeVideoEl.src = "";
        activeVideoEl.remove();
      }
      canvas.remove();
      
      try { audioCtx.close(); } catch(e){}

      if (chunks.length === 0) reject(new Error("No se obtuvieron fotogramas."));
      resolve(URL.createObjectURL(new Blob(chunks, { type: mime })));
    };

    // Grabamos guardando los trozos cada 1000ms
    recorder.start(1000);
    const start = performance.now();
    
    await loadVideo(0);
    currentClipIdx = 0;

    const draw = () => {
      if (isFinished) return;
      
      const now = performance.now();
      const elapsed = (now - start) / 1000;
      
      const timeSinceLastDraw = now - lastDrawTime;
      if (timeSinceLastDraw > fpsInterval) {
        lastDrawTime = now - (timeSinceLastDraw % fpsInterval);
        
        onProgress(Math.min(100, (elapsed / targetDuration) * 100));

        if (elapsed >= targetDuration) {
          isFinished = true;
          recorder.stop();
          return;
        }

        const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
        
        if (activeIdx !== currentClipIdx) {
          currentClipIdx = activeIdx;
          loadVideo(currentClipIdx);
        }

        // Limpiar el lienzo (fundamental para liberar la VRAM)
        ctx.clearRect(0, 0, width, height); 
        ctx.fillStyle = "#000000"; 
        ctx.fillRect(0, 0, width, height);
        
        if (activeVideoEl && activeVideoEl.readyState >= 2) {
          const scale = Math.max(width / activeVideoEl.videoWidth, height / activeVideoEl.videoHeight);
          const dw = activeVideoEl.videoWidth * scale;
          const dh = activeVideoEl.videoHeight * scale;
          ctx.drawImage(activeVideoEl, (width - dw) / 2, (height - dh) / 2, dw, dh);
        }

        // Subtítulos adaptados a la nueva resolución
        const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
        if (cue) {
          ctx.font = '900 32px "Inter", sans-serif'; // Letra más pequeña para el lienzo más pequeño
          ctx.textAlign = "center"; 
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          const txt = cue.text;
          const y = height * 0.75;
          
          ctx.lineWidth = 6; 
          ctx.strokeStyle = "#000";
          ctx.strokeText(txt, width / 2, y);
          ctx.fillStyle = "#FFE600";
          ctx.fillText(txt, width / 2, y);
        }
      }

      frameId = requestAnimationFrame(draw);
    };
    
    frameId = requestAnimationFrame(draw);
    
    // Watchdog
    setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        recorder.stop();
      }
    }, (targetDuration + 3) * 1000);
  });
}
