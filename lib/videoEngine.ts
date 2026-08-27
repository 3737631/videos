import { RenderConfig, SubtitleCue } from "@/types";

const INVISIBLE_CSS = "position:fixed;top:0;left:-9999px;width:270px;height:480px;z-index:-100;pointer-events:none;";

// AUTO-AJUSTE PERFECTO DE SUBTÍTULOS (Centrado vertical y horizontal)
function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  const lineHeight = 30; 

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
  
  // Calculamos el Y para que todo el bloque quede centrado perfectamente
  let currentY = y - ((lines.length - 1) * lineHeight) / 2; 
  
  for (let k = 0; k < lines.length; k++) {
    // Al usar textAlign = "center", la x debe ser la mitad del canvas
    ctx.strokeText(lines[k], x, currentY);
    ctx.fillText(lines[k], x, currentY);
    currentY += lineHeight;
  }
}

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress, mode } = config;
  
  const width = 270;
  const height = 480;
  
  // EL MOTOR FLUIDO Y SIN TIRONES (ESTÁNDAR TIKTOK)
  const FPS = 30; 
  const frameInterval = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.cssText = INVISIBLE_CSS;
  document.body.appendChild(canvas);
  
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Tu navegador no permite gráficos 2D.");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let dest: MediaStreamAudioDestinationNode | null = null;
  let audioCtx: AudioContext | null = null;
  let isAudioAlive = false;

  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      dest = audioCtx.createMediaStreamDestination();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0; 
      osc.connect(silentGain);
      silentGain.connect(dest);
      osc.start();

      if (audioBlob) {
        const ab = await audioBlob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(ab);
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        
        if (mode === "voice") {
          // Acelerador sutil para dinamismo sin romper la voz
          let speedRatio = decoded.duration / targetDuration;
          speedRatio = Math.max(0.8, Math.min(speedRatio, 1.3)); 
          source.playbackRate.value = speedRatio;
        } else {
          source.loop = true;
        }

        source.connect(dest);
        source.start(0);
      }
      if (audioCtx.state === "running") isAudioAlive = true;
    }
  } catch (e) {}

  const captureStreamFunc = canvas.captureStream || (canvas as any).mozCaptureStream || (canvas as any).webkitCaptureStream;
  const canvasStream = captureStreamFunc.call(canvas, FPS);
  const tracks = [...canvasStream.getVideoTracks()];
  if (dest && isAudioAlive) tracks.push(...dest.stream.getAudioTracks());
  const combinedStream = new MediaStream(tracks);
  
  const isApple = /iPhone|iPad|iPod|Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
  const checkMime = (t: string) => { try { return MediaRecorder.isTypeSupported?.(t); } catch { return false; } };
  
  let mime = "";
  if (isApple && checkMime("video/mp4")) mime = "video/mp4";
  else if (checkMime("video/webm;codecs=vp8,opus")) mime = "video/webm;codecs=vp8,opus";
  else if (checkMime("video/webm;codecs=vp8")) mime = "video/webm;codecs=vp8";
  else if (checkMime("video/webm")) mime = "video/webm";

  let recorder: MediaRecorder;
  try {
    recorder = mime 
      ? new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 1000000 }) 
      : new MediaRecorder(combinedStream);
  } catch (err) {
    recorder = new MediaRecorder(combinedStream);
  }
  
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise<string>(async (resolve, reject) => {
    let isFinished = false;
    let isResolved = false; 
    let currentClipIdx = -1;
    let activeVideo: HTMLVideoElement | null = null;
    let lastDrawTime = performance.now();
    let frameId = 0;
    
    // Calculamos los cortes basados en la duración garantizada
    const clipStartTimes: number[] = [];
    const clipDur = targetDuration / clips.length;
    let acc = 0;
    for (const c of clips) {
      clipStartTimes.push(acc);
      acc += clipDur;
    }

    const finalize = () => {
      if (isResolved) return;
      isResolved = true; 
      cancelAnimationFrame(frameId);
      tracks.forEach(t => t.stop());
      if (activeVideo) {
        activeVideo.removeAttribute("src");
        activeVideo.remove();
      }
      setTimeout(() => { canvas.width = 0; canvas.remove(); }, 200);
      try { audioCtx?.close(); } catch(e){}

      if (chunks.length === 0) reject(new Error("No se procesó vídeo."));
      else resolve(URL.createObjectURL(new Blob(chunks, { type: mime || "video/mp4" })));
    };

    const stopRecording = () => {
      if (isFinished) return;
      isFinished = true;
      try {
        if (recorder.state !== "inactive") {
          try { recorder.requestData(); } catch(e){} 
          try { recorder.stop(); } catch(e){}
        }
      } catch(e){}
      setTimeout(finalize, 1000); 
    };

    // MAGIA ANTI-TIRONES
    const loadVideoAsync = async (index: number) => {
      if (index >= clips.length) return;

      const newVideo = document.createElement("video");
      newVideo.src = clips[index].url;
      // Empieza en un momento aleatorio para dar dinamismo a los cortes
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
        config.onProgress(Math.min(100, (elapsed / targetDuration) * 100));

        if (elapsed >= targetDuration) {
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

        // DIBUJADO DE SUBTÍTULOS PERFECTAMENTE CENTRADO
        if (config.mode === "voice" && cues) {
          const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
          if (cue) {
            ctx.font = '900 28px "Inter", sans-serif'; 
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            
            ctx.lineWidth = 5; 
            ctx.strokeStyle = "#000";
            ctx.fillStyle = "#FFE600";
            
            // X siempre en la mitad (width/2) y maxWidth ajustado para que no toque los bordes
            drawWrappedText(ctx, cue.text.toUpperCase(), width / 2, height * 0.75, width - 40);
          }
        }
      }
    };
    
    drawLoop();
    setTimeout(stopRecording, (targetDuration + 2) * 1000);
  });
}
