import { RenderConfig } from "@/types";

const CANVAS_CSS = "position:absolute;top:0;left:0;width:270px;height:480px;opacity:0.001;pointer-events:none;z-index:-100;";

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  const lineHeight = 32; 

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());
  
  let currentY = y - ((lines.length - 1) * lineHeight) / 2; 
  
  for (let k = 0; k < lines.length; k++) {
    ctx.strokeText(lines[k], x, currentY);
    ctx.fillText(lines[k], x, currentY);
    currentY += lineHeight;
  }
}

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, targetDuration, onProgress, mode } = config;
  const wordChunks = (config as any).wordChunks;
  
  const width = 270;
  const height = 480;
  const FPS = 30; 
  const frameInterval = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width; 
  canvas.height = height;
  canvas.style.cssText = CANVAS_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Tu navegador no soporta Canvas 2D.");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let dest: MediaStreamAudioDestinationNode | null = null;
  let audioCtx: AudioContext | null = null;
  let actualDuration = Math.max(10, targetDuration || 10);
  let dynamicCues: string[] = [];

  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      dest = audioCtx.createMediaStreamDestination();

      const osc = audioCtx.createOscillator();
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0.01; 
      osc.connect(silentGain);
      silentGain.connect(dest);
      osc.start();

      if (audioBlob) {
        const ab = await audioBlob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(ab).catch(() => null);

        if (decoded && decoded.duration > 1) {
          actualDuration = Math.max(8, decoded.duration);
          const source = audioCtx.createBufferSource();
          source.buffer = decoded;
          
          if (mode === "voice") {
            source.playbackRate.value = 1.20;
            actualDuration = actualDuration / 1.20;
          } else {
            source.loop = true;
          }

          source.connect(dest);
          source.start(0);
        }
      }

      dynamicCues = (wordChunks && wordChunks.length > 0) ? wordChunks.map((w: string) => w.toUpperCase()) : ["¡MIRA ESTO!", "DESCÚBRELO", "AHORA"];
    }
  } catch (e) {
    console.warn("Aviso de audio:", e);
  }

  const captureStreamFunc = canvas.captureStream || (canvas as any).mozCaptureStream || (canvas as any).webkitCaptureStream;
  if (!captureStreamFunc) throw new Error("Tu navegador no soporta captura de vídeo.");
  
  const stream = captureStreamFunc.call(canvas, FPS);
  if (dest) {
    dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
  }

  const possibleMimes = [
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4"
  ];
  let selectedMime = "";
  for (const m of possibleMimes) {
    if (MediaRecorder.isTypeSupported(m)) {
      selectedMime = m;
      break;
    }
  }

  let recorder: MediaRecorder;
  try {
    recorder = selectedMime 
      ? new MediaRecorder(stream, { mimeType: selectedMime, videoBitsPerSecond: 1500000 }) 
      : new MediaRecorder(stream);
  } catch (err) {
    recorder = new MediaRecorder(stream);
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let currentClipIdx = -1;
    let activeVideo: HTMLVideoElement | null = null;
    let lastDrawTime = performance.now();
    let frameId = 0;
    
    const clipDur = actualDuration / clips.length;

    const finalize = () => {
      cancelAnimationFrame(frameId);
      if (activeVideo) { 
        activeVideo.pause();
        activeVideo.removeAttribute("src"); 
        activeVideo.remove(); 
      }
      if (canvas.parentNode) canvas.remove();
      try { audioCtx?.close(); } catch(e){}

      if (chunks.length === 0) {
        reject(new Error("No se procesó vídeo (Cero fotogramas capturados)."));
      } else {
        const finalBlob = new Blob(chunks, { type: recorder.mimeType || selectedMime || "video/webm" });
        resolve(URL.createObjectURL(finalBlob));
      }
    };

    const stopRecording = () => {
      if (isFinished) return;
      isFinished = true;
      try {
        if (recorder.state === "recording") {
          recorder.stop();
        } else {
          finalize();
        }
      } catch(e) {
        finalize();
      }
    };

    recorder.onstop = () => {
      setTimeout(finalize, 200);
    };

    recorder.onerror = () => reject(new Error("Error interno del grabador."));

    recorder.start();

    const loadVideoAsync = async (index: number) => {
      if (index >= clips.length) return;

      const newVideo = document.createElement("video");
      newVideo.src = clips[index].url;
      newVideo.currentTime = Math.random() * Math.max(0, clips[index].playDuration - clipDur);
      newVideo.muted = true;
      newVideo.playsInline = true;
      newVideo.style.cssText = CANVAS_CSS;
      document.body.appendChild(newVideo);
      
      await new Promise<void>(res => { 
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            res();
          }
        };
        newVideo.oncanplay = done;
        newVideo.onloadeddata = done;
        setTimeout(done, 1200);
      });
      
      newVideo.play().catch(()=>{});

      const oldVideo = activeVideo;
      activeVideo = newVideo;

      if (oldVideo) {
        oldVideo.pause();
        oldVideo.removeAttribute("src");
        oldVideo.load();
        oldVideo.remove();
      }
    };

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
        onProgress(Math.min(100, (elapsed / actualDuration) * 100));

        if (elapsed >= actualDuration) {
          stopRecording();
          return;
        }

        const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
        if (activeIdx !== currentClipIdx) {
          currentClipIdx = activeIdx;
          loadVideoAsync(activeIdx); 
        }

        ctx.fillStyle = "#000000"; 
        ctx.fillRect(0, 0, width, height);

        if (activeVideo && activeVideo.readyState >= 2) {
          const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
          const dw = activeVideo.videoWidth * scale;
          const dh = activeVideo.videoHeight * scale;
          ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
        }

        // SUBTÍTULOS DINÁMICOS POR ÍNDICE EXACTO (Vertical 270x480, ancho máximo 200px para que nunca salgan)
        if (mode === "voice" && dynamicCues.length > 0) {
          const progressRatio = Math.min(0.9999, elapsed / actualDuration);
          const cueIndex = Math.floor(progressRatio * dynamicCues.length);
          const currentText = dynamicCues[cueIndex];

          if (currentText) {
            ctx.font = '900 26px "Inter", sans-serif'; 
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            
            ctx.lineWidth = 5; 
            ctx.strokeStyle = "#000";
            ctx.fillStyle = "#FFE600";
            
            // Ancho máximo estricto de 200 píxeles para el lienzo vertical de 270px
            drawWrappedText(ctx, currentText, width / 2, height * 0.70, 200);
          }
        }
      }
    };
    
    drawLoop();
    setTimeout(stopRecording, (actualDuration + 3) * 1000);
  });
}
