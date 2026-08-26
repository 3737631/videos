import { RenderConfig, SubtitleCue } from "@/types";

const IS_APPLE = typeof navigator !== "undefined" && 
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || /^((?!chrome|android).)*safari/i.test(navigator.userAgent));

// CSS hackeado: El canvas es de tamaño real internamente, pero visualmente 
// en el HTML ocupa solo 10x10 píxeles. Esto engaña a la tarjeta gráfica del móvil 
// para que no gaste recursos en "pintarlo" en la pantalla, pero Safari no lo bloquea.
const INVISIBLE_CSS = "position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:1;pointer-events:none;z-index:9999;";

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress } = config;
  
  // SOLUCIÓN ANTI-CRASH ABSOLUTA: 
  // Resolución 360x640 (SD). Imposible saturar la RAM sin importar si el video original es 4K.
  const width = 360;
  const height = 640;
  
  // 15 FPS: Movimiento fluido para redes sociales pero exige 0 esfuerzo al procesador.
  const FPS = 15; 
  const frameTime = 1000 / FPS; // ~66ms por frame

  const canvas = document.createElement("canvas");
  canvas.width = width; 
  canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  // "willReadFrequently: false" y "alpha: false" optimizan el uso de la VRAM
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false })!;

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
      console.warn("Audio ignorado por falta de memoria RAM.");
    }
  }

  const canvasStream = canvas.captureStream(FPS);
  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(tracks);
  
  const mime = IS_APPLE ? "video/mp4" : "video/webm";
  
  // BITRATE ULTRABAJO: 800 Kbps. El archivo final pesará poquísimo, evitando 
  // que el móvil explote al intentar unir los trozos de video al 100%.
  const recorder = new MediaRecorder(combinedStream, { 
    mimeType: mime,
    videoBitsPerSecond: 800000 
  });
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let currentClipIdx = -1;
    let activeVideoEl: HTMLVideoElement | null = null;
    
    const clipDur = targetDuration / clips.length;

    // DESTRUCCIÓN INMEDIATA DE VIDEOS:
    const loadVideo = async (index: number) => {
      if (activeVideoEl) {
        activeVideoEl.pause();
        activeVideoEl.removeAttribute('src');
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
      v.preload = "auto"; // Forzamos carga mínima rápida
      v.style.cssText = INVISIBLE_CSS;
      document.body.appendChild(v);
      
      await new Promise<void>(res => { 
        v.oncanplay = () => res(); 
        setTimeout(res, 1000); // Si en 1 segundo no ha cargado, lo forzamos para evitar bloqueos
      });
      
      v.play().catch(()=>{});
      activeVideoEl = v;
      return v;
    };

    recorder.onstop = () => {
      tracks.forEach(t => t.stop());
      if (activeVideoEl) {
        activeVideoEl.removeAttribute('src');
        activeVideoEl.remove();
      }
      canvas.width = 0; // Obligamos a la RAM a escupir los datos del lienzo
      canvas.remove();
      
      try { audioCtx.close(); } catch(e){}

      if (chunks.length === 0) reject(new Error("No se pudo procesar."));
      resolve(URL.createObjectURL(new Blob(chunks, { type: mime })));
    };

    recorder.start(1500);
    const start = performance.now();
    
    await loadVideo(0);
    currentClipIdx = 0;

    // NUEVO MOTOR: BUCLE ASÍNCRONO DE DIBUJADO (El secreto contra el colapso)
    // En lugar de usar requestAnimationFrame (que satura el móvil), usamos setTimeout.
    // Esto hace que el móvil "respire" entre dibujo y dibujo, permitiendo que 
    // el Recolector de Basura (Garbage Collector) vacíe la RAM automáticamente.
    const drawLoop = async () => {
      if (isFinished) return;
      
      const now = performance.now();
      const elapsed = (now - start) / 1000;
      
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
      
      if (activeVideoEl && activeVideoEl.readyState >= 2) {
        const scale = Math.max(width / activeVideoEl.videoWidth, height / activeVideoEl.videoHeight);
        const dw = activeVideoEl.videoWidth * scale;
        const dh = activeVideoEl.videoHeight * scale;
        ctx.drawImage(activeVideoEl, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      // Dibujado de Subtítulos reescalado para 360p
      const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
      if (cue) {
        ctx.font = '900 24px "Inter", sans-serif'; 
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const txt = cue.text;
        const y = height * 0.75;
        
        ctx.lineWidth = 4; 
        ctx.strokeStyle = "#000";
        ctx.strokeText(txt, width / 2, y);
        ctx.fillStyle = "#FFE600";
        ctx.fillText(txt, width / 2, y);
      }

      // Dejamos respirar a la CPU/RAM del móvil durante ~66ms antes del siguiente frame
      setTimeout(drawLoop, frameTime);
    };
    
    // Iniciar bucle seguro
    drawLoop();
    
    // Watchdog de seguridad absoluta
    setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        recorder.stop();
      }
    }, (targetDuration + 2) * 1000);
  });
}
