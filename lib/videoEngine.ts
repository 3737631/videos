import { RenderConfig } from "@/types";

// Solución al error de procesamiento: Opacidad invisible en lugar de fuera de pantalla para evitar el throttling del navegador
const INVISIBLE_CSS = "position:absolute;top:0;left:0;width:270px;height:480px;opacity:0.001;pointer-events:none;z-index:-100;";

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
  const { clips, audioBlob, cues, targetDuration, onProgress, mode } = config;
  const wordChunks = (config as any).wordChunks;
  
  const width = 270;
  const height = 480;
  const FPS = 30; 
  const frameInterval = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width; 
  canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Tu navegador no soporta Canvas 2D.");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let dest: MediaStreamAudioDestinationNode | null = null;
  let audioCtx: AudioContext | null = null;
  let actualDuration = targetDuration || 10;
  let dynamicCues: {text: string, start: number, end: number}[] = [];

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

        if (decoded && decoded.duration > 0) {
          actualDuration = decoded.duration;
          const source = audioCtx.createBufferSource();
          source.buffer = decoded;
          
          if (mode === "voice") {
            let speedRatio = actualDuration / targetDuration;
            speedRatio = Math.max(0.8, Math.min(speedRatio, 1.5)); 
            source.playbackRate.value = speedRatio;
          } else {
            source.loop = true;
          }

          source.connect(dest);
          source.start(0);
        }
      }

      if (mode === "voice" && wordChunks && wordChunks.length > 0) {
        const timePerChunk = actualDuration / wordChunks.length;
        wordChunks.forEach((text: string, i: number) => {
          dynamicCues.push({
            text: text.toUpperCase(),
            start: i * timePerChunk,
            end: (i + 1) * timePerChunk
          });
        });
      }
    }
  } catch (e) {
    console.warn("Aviso de audio:", e);
  }

  const captureStreamFunc = canvas.captureStream || (canvas as any).mozCaptureStream || (canvas as any).webkitCaptureStream;
  const canvasStream = captureStreamFunc.call(canvas, FPS);
  const tracks = [...canvasStream.getVideoTracks()];
  if (dest) tracks.push(...dest.stream.getAudioTracks());
  const combinedStream = new MediaStream(tracks);
  
  // Selección segura de formato para MediaRecorder
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : MediaRecorder.isTypeSupported("video/webm")
    ? "video/webm"
    : "";

  let recorder: MediaRecorder;
  try {
    recorder = mimeType 
      ? new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 1000000 }) 
      : new MediaRecorder(combinedStream);
  } catch (err) {
    recorder = new MediaRecorder(combinedStream);
  }
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { 
    if (e.data && e.data.size > 0) {
      chunks.push(e.data); 
    }
  };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let isResolved = false; 
    let currentClipIdx = -1;
    let activeVideo: HTMLVideoElement | null = null;
    let lastDrawTime = performance.now();
    let frameId = 0;
    
    const clipDur = actualDuration / clips.length;

    const finalize = () => {
      if (isResolved) return;
      isResolved = true; 
      cancelAnimationFrame(frameId);
      tracks.forEach(t => t.stop());
      if (activeVideo) {
        activeVideo.removeAttribute("src");
        activeVideo.remove();
      }
      setTimeout(() => { 
        if (canvas.parentNode) canvas.remove(); 
      }, 200);
      try { audioCtx?.close(); } catch(e){}

      if (chunks.length === 0) {
        reject(new Error("No se procesó vídeo (Cero fotogramas capturados)."));
      } else {
        const finalBlob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        resolve(URL.createObjectURL(finalBlob));
      }
    };

    const stopRecording = () => {
      if (isFinished) return;
      isFinished = true;
      try {
        if (recorder.state === "recording") {
          recorder.requestData();
          recorder.stop();
        } else {
          finalize();
        }
      } catch(e) {
        finalize();
      }
    };

    const loadVideoAsync = async (index: number) => {
      if (index >= clips.length) return;

      const newVideo = document.createElement("video");
      newVideo.src = clips[index].url;
      newVideo.currentTime = Math.random() * Math.max(0, clips[index].playDuration - clipDur);
      newVideo.muted = true;
      newVideo.playsInline = true;
      newVideo.style.cssText = INVISIBLE_CSS;
      document.body.appendChild(newVideo);
      
      await new Promise<void>(res => { 
        newVideo.oncanplay = () => res(); 
        setTimeout(res, 400); 
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

    recorder.onstop = finalize;
    recorder.onerror = () => reject(new Error("Error interno del grabador de vídeo."));

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
        onProgress(Math.min(100, (elapsed / actualDuration) * 100));

        if (elapsed >= actualDuration) {
          stopRecording();
          return;
        }

        const activeIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
        if (activeIdx !== currentClipIdx) {
          currentClipIdx = activeIdx;
          loadVideoAsync(currentClipIdx); 
        }

        ctx.fillStyle = "#000000"; 
        ctx.fillRect(0, 0, width, height);

        if (activeVideo && activeVideo.readyState >= 2) {
          const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
          const dw = activeVideo.videoWidth * scale;
          const dh = activeVideo.videoHeight * scale;
          ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
        }

        if (mode === "voice") {
          const cue = dynamicCues.find(c => elapsed >= c.start && elapsed < c.end);
          if (cue) {
            ctx.font = '900 28px "Inter", sans-serif'; 
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            
            ctx.lineWidth = 5; 
            ctx.strokeStyle = "#000";
            ctx.fillStyle = "#FFE600";
            
            drawWrappedText(ctx, cue.text, width / 2, height * 0.75, width - 40);
          }
        }
      }
    };
    
    drawLoop();
    setTimeout(stopRecording, (actualDuration + 2) * 1000);
  });
}
