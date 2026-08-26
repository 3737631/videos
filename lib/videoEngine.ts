import { RenderConfig, SubtitleCue } from "@/types";

const INVISIBLE_CSS = "position:fixed;top:0;left:-9999px;width:270px;height:480px;z-index:-100;pointer-events:none;";

// FUNCIÓN DE AUTO-AJUSTE DE TEXTO (Para que nunca se salga de pantalla)
function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  const lineHeight = 30; // Altura entre líneas

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  
  // Centramos el bloque de texto verticalmente
  let currentY = y - ((lines.length - 1) * lineHeight) / 2; 
  
  for (let k = 0; k < lines.length; k++) {
    ctx.strokeText(lines[k].trim(), x, currentY);
    ctx.fillText(lines[k].trim(), x, currentY);
    currentY += lineHeight;
  }
}

export async function renderFinalVideo(config: RenderConfig): Promise<string> {
  const { clips, audioBlob, cues, targetDuration, onProgress, mode } = config;
  
  const width = 270;
  const height = 480;
  const FPS = 15; 
  const frameTime = 1000 / FPS;

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
          let speedRatio = decoded.duration / targetDuration;
          speedRatio = Math.max(0.8, Math.min(speedRatio, 1.8)); 
          source.playbackRate.value = speedRatio;
        } else {
          source.loop = true;
        }

        source.connect(dest);
        source.start(0);
      }
      if (audioCtx.state === "running") isAudioAlive = true;
    }
  } catch (e) {
    console.warn("Audio desactivado.");
  }

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
      ? new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 800000 }) 
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
    
    const clipStartTimes: number[] = [];
    let acc = 0;
    for (const c of clips) {
      clipStartTimes.push(acc);
      acc += c.playDuration;
    }

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
      activeVideo.currentTime = clips[index].startOffset; 
      activeVideo.muted = true;
      activeVideo.playsInline = true;
      activeVideo.style.cssText = INVISIBLE_CSS;
      document.body.appendChild(activeVideo);
      
      await new Promise<void>(res => { 
        if (!activeVideo) return res();
        activeVideo.oncanplay = () => res(); 
        setTimeout(res, 500); 
      });
      
      if (activeVideo) activeVideo.currentTime = clips[index].startOffset;
      activeVideo?.play().catch(()=>{});
    };

    recorder.onstop = finalize;
    recorder.onerror = () => reject(new Error("Error interno al grabar."));

    recorder.start(250); 
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

      let activeIdx = clipStartTimes.findIndex((time, i) => {
        const nextTime = clipStartTimes[i + 1] || targetDuration + 1;
        return elapsed >= time && elapsed < nextTime;
      });
      if (activeIdx === -1) activeIdx = clips.length - 1;

      if (activeIdx !== currentClipIdx) {
        currentClipIdx = activeIdx;
        await loadVideo(currentClipIdx);
      }

      // SOLUCIÓN PANTALLAZO NEGRO: 
      // Solo borramos y pintamos negro si el vídeo nuevo YA ha cargado (readyState >= 2).
      // Si no ha cargado, dejamos la imagen congelada del vídeo anterior. ¡Mucho más profesional!
      if (activeVideo && activeVideo.readyState >= 2) {
        ctx.fillStyle = "#000000"; 
        ctx.fillRect(0, 0, width, height);

        const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
        const dw = activeVideo.videoWidth * scale;
        const dh = activeVideo.videoHeight * scale;
        ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      // DIBUJO DE SUBTÍTULOS AJUSTADO
      if (config.mode === "voice") {
        const cue = cues.find(c => elapsed >= c.start && elapsed <= c.end);
        if (cue) {
          ctx.font = '900 24px "Inter", sans-serif'; 
          ctx.textAlign = "center"; 
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          
          ctx.lineWidth = 5; 
          ctx.strokeStyle = "#000";
          ctx.fillStyle = "#FFE600";
          
          // Usamos el Auto-Ajuste: Max width de 240px (deja un margen de 15px por lado)
          drawWrappedText(ctx, cue.text, width / 2, height * 0.75, 240);
        }
      }

      setTimeout(drawLoop, frameTime);
    };
    
    drawLoop();
    setTimeout(stopRecording, (targetDuration + 2) * 1000);
  });
}
