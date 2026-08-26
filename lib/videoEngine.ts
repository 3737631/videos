import { RenderConfig, SubtitleCue } from "@/types";

const IS_APPLE = typeof navigator !== "undefined" && 
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || /^((?!chrome|android).)*safari/i.test(navigator.userAgent));

const INVISIBLE_CSS = "position:fixed;left:-9999px;top:0;width:300px;height:300px;opacity:1;pointer-events:none;z-index:9999;";

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress } = config;
  const width = 720, height = 1280;

  // 1. Crear Canvas
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false })!;

  // 2. Audio Context (Despertar en Safari)
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
    const ab = await audioBlob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(ab);
    const source = audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(dest);
    source.start(0);
  }

  // 3. Configurar Grabador (Compresión en tiempo real para no saturar memoria)
  const canvasStream = canvas.captureStream(30);
  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(tracks);
  
  const mime = IS_APPLE ? "video/mp4" : "video/webm";
  // Bajamos el bitrate a 2.5 Mbps para comprimir al vuelo y evitar bloqueos
  const recorder = new MediaRecorder(combinedStream, { 
    mimeType: mime,
    videoBitsPerSecond: 2500000 
  });
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let frameId = 0;
    let isFinished = false;
    let currentClipIdx = -1;
    let activeVideoEl: HTMLVideoElement | null = null;
    const clipDur = targetDuration / clips.length;

    // SISTEMA ANTI-COLAPSO (Carga Secuencial)
    // Carga un vídeo nuevo y DESTRUYE el anterior de la memoria RAM
    const loadVideo = async (index: number) => {
      if (activeVideoEl) {
        activeVideoEl.pause();
        activeVideoEl.removeAttribute('src');
        activeVideoEl.load(); // Fuerza vaciado de RAM
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
        v.oncanplay = () => res(); 
        setTimeout(res, 3000); // Timeout por si el vídeo pesa demasiado
      });
      
      v.play().catch(()=>{});
      activeVideoEl = v;
      return v;
    };

    recorder.onstop = () => {
      cancelAnimationFrame(frameId);
      tracks.forEach(t => t.stop());
      if (activeVideoEl) {
        activeVideoEl.removeAttribute('src');
        activeVideoEl.remove();
      }
      canvas.remove();
      if (chunks.length === 0) reject(new Error("No se pudo renderizar."));
      resolve(URL.createObjectURL(new Blob(chunks, { type: mime })));
    };

    // Iniciar Grabación
    recorder.start(100);
    const start = performance.now();
    
    // Cargar el primer vídeo a RAM
    await loadVideo(0);
    currentClipIdx = 0;

    const draw = () => {
      if (isFinished) return;
      const elapsed = (performance.now() - start) / 1000;
      onProgress(Math.min(100, (elapsed / targetDuration) * 100));

      if (elapsed >= targetDuration) {
        isFinished = true;
        recorder.stop();
        return;
      }

      const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
      
      // Si toca cambiar de vídeo, lo cargamos dinámicamente
      if (activeIdx !== currentClipIdx) {
        currentClipIdx = activeIdx;
        loadVideo(currentClipIdx);
      }

      ctx.fillStyle = "#09090b"; 
      ctx.fillRect(0, 0, width, height);
      
      if (activeVideoEl && activeVideoEl.readyState >= 2) {
        const scale = Math.max(width / activeVideoEl.videoWidth, height / activeVideoEl.videoHeight);
        const dw = activeVideoEl.videoWidth * scale;
        const dh = activeVideoEl.videoHeight * scale;
        ctx.drawImage(activeVideoEl, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      // Dibujar subtítulos
      const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
      if (cue) {
        ctx.font = '900 42px "Inter", sans-serif';
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const txt = cue.text;
        const y = height * 0.75;
        
        ctx.lineWidth = 8; ctx.strokeStyle = "#000";
        ctx.strokeText(txt, width / 2, y);
        ctx.fillStyle = "#FFE600";
        ctx.fillText(txt, width / 2, y);
      }

      frameId = requestAnimationFrame(draw);
    };
    
    frameId = requestAnimationFrame(draw);
    
    // Watchdog salvavidas: si por lo que sea se bloquea, detiene y guarda lo hecho a los pocos segundos
    setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        recorder.stop();
      }
    }, (targetDuration + 5) * 1000);
  });
}
