import { RenderConfig, SubtitleCue } from "@/types";

const CANVAS_CSS = "position:absolute;top:0;left:0;width:270px;height:480px;opacity:0.001;pointer-events:none;z-index:-100;";

type ExtCanvasElement = HTMLCanvasElement & {
  captureStream(fps?: number): MediaStream;
  mozCaptureStream(fps?: number): MediaStream;
  webkitCaptureStream(fps?: number): MediaStream;
};

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];
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
  let currentY = y - ((lines.length - 1) * lineHeight) / 2;
  for (let k = 0; k < lines.length; k++) {
    ctx.strokeText(lines[k], x, currentY);
    ctx.fillText(lines[k], x, currentY);
    currentY += lineHeight;
  }
}

export async function renderFinalVideo(config: RenderConfig): Promise<{ url: string, mimeType: string }> {
  const { clips, audioBuffer, audioContext, mode, wordChunks, onProgress, isFallback } = config;
  const width = 270;
  const height = 480;
  const FPS = 30;
  const frameInterval = 1000 / FPS;

  if (!clips || clips.length === 0) throw new Error("No hay clips de vídeo.");
  if (!audioBuffer) throw new Error("Audio corrupto o inexistente.");

  // Canvas visible para debug pero oculto para capture
  const canvas = document.createElement("canvas") as ExtCanvasElement;
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = CANVAS_CSS;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D no soportado.");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let dest: MediaStreamAudioDestinationNode | null = null;
  let actualDuration = Math.max(1.2, audioBuffer.duration);
  let voiceDuration = actualDuration;
  const dynamicCues: SubtitleCue[] = [];

  try {
    if (audioContext.state === "suspended") await audioContext.resume();
    dest = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    if (mode === "voice") {
      if (isFallback) {
        const rate = 1.48;
        source.playbackRate.value = rate;
        voiceDuration = actualDuration / rate;
      } else {
        const rate = 1.58;
        source.playbackRate.value = rate;
        voiceDuration = actualDuration / rate;
      }
      // Viral: voz y subtítulos perfectamente sincronizados, cola breve sin subtítulo
      actualDuration = voiceDuration + 0.28;
      voiceDuration = actualDuration - 0.28;
    } else {
      source.loop = true;
      voiceDuration = actualDuration;
    }
    source.connect(dest);
    source.start(0);
    if (mode === "voice" && wordChunks && wordChunks.length > 0) {
      const totalChars = wordChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      let acc = 0;
      for (const chunk of wordChunks) {
        const w = chunk.length / Math.max(1, totalChars);
        const d = w * voiceDuration;
        dynamicCues.push({ text: chunk, start: acc, end: acc + d });
        acc += d;
      }
      // Cierre: asegurar que último subtítulo no se extiende al silencio de cola
      if (dynamicCues.length > 0) {
        const last = dynamicCues[dynamicCues.length - 1];
        if (last.end > voiceDuration) last.end = voiceDuration;
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (canvas.parentNode) canvas.remove();
    throw new Error("Fallo stream audio: " + msg);
  }

  const captureFn = canvas.captureStream || canvas.mozCaptureStream || canvas.webkitCaptureStream;
  if (!captureFn) throw new Error("Captura de Canvas no soportada.");
  const stream = captureFn.call(canvas, FPS);
  if (dest) {
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  }

  // Safari prefiere mp4
  const mimes = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
  let selectedMime = "video/webm";
  for (const m of mimes) if (MediaRecorder.isTypeSupported(m)) { selectedMime = m; break; }
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: selectedMime, videoBitsPerSecond: 1500000 });
  } catch {
    recorder = new MediaRecorder(stream);
    selectedMime = recorder.mimeType || "video/webm";
  }
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise<{ url: string, mimeType: string }>((resolve, reject) => {
    let isFinished = false;
    let currentClipIdx = 0;
    let activeVideo: HTMLVideoElement | null = null;
    let lastDrawTime = performance.now();
    let frameId = 0;
    const clipDur = actualDuration / clips.length;
    const preloaded: HTMLVideoElement[] = [];

    const finalize = () => {
      cancelAnimationFrame(frameId);
      for (const v of preloaded) {
        try { v.pause(); } catch {}
        v.removeAttribute("src");
        try { v.load(); } catch {}
        v.remove();
      }
      if (activeVideo && !preloaded.includes(activeVideo)) {
        try { activeVideo.pause(); } catch {}
        activeVideo.removeAttribute("src");
        try { activeVideo.load(); } catch {}
        activeVideo.remove();
      }
      if (canvas.parentNode) canvas.remove();
      if (chunks.length === 0) reject(new Error("Cero fotogramas capturados. Prueba con otro vídeo más corto."));
      else {
        const blob = new Blob(chunks, { type: selectedMime });
        resolve({ url: URL.createObjectURL(blob), mimeType: selectedMime });
      }
    };
    const stopRecording = () => {
      if (isFinished) return;
      isFinished = true;
      try { if (recorder.state === "recording") recorder.stop(); else finalize(); } catch { finalize(); }
    };
    recorder.onstop = () => setTimeout(finalize, 250);
    recorder.onerror = () => reject(new Error("Error grabador MediaRecorder"));
    recorder.start(100);

    // Precarga todos los clips a la vez para que el cambio sea instantáneo y no trabe
    const preloadAll = async () => {
      const promises = clips.map(async (clip, idx) => {
        const safeDur = Number.isFinite(clip.playDuration) && clip.playDuration > 0.6 ? clip.playDuration : 5;
        const maxOffset = Math.max(0, safeDur - clipDur - 0.3);
        const offset = maxOffset > 0.3 ? Math.random() * maxOffset : Math.random() * Math.max(0, safeDur * 0.3);
        const v = document.createElement("video");
        v.src = clip.url;
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.crossOrigin = "anonymous";
        v.loop = true;
        v.style.cssText = CANVAS_CSS;
        v.setAttribute("playsinline", "");
        document.body.appendChild(v);
        await new Promise<void>((res) => {
          let done = false;
          const finish = () => { if (!done) { done = true; res(); } };
          if (v.readyState >= 1) finish();
          else {
            v.addEventListener("loadedmetadata", finish, { once: true });
            v.addEventListener("error", finish, { once: true });
            setTimeout(finish, 1500);
          }
        });
        try {
          if (Number.isFinite(offset) && v.duration && offset < v.duration) v.currentTime = offset;
        } catch {}
        await new Promise<void>((res) => {
          let done = false;
          const finish = () => { if (!done) { done = true; res(); } };
          if (v.readyState >= 2) finish();
          else {
            v.addEventListener("canplay", finish, { once: true });
            v.addEventListener("loadeddata", finish, { once: true });
            v.addEventListener("error", finish, { once: true });
            setTimeout(finish, 700);
          }
        });
        try { await v.play(); } catch {}
        if (v.readyState < 2 || v.videoWidth === 0) {
          console.warn(`[VIDEO] clip ${idx} no listo w=${v.videoWidth} - se ocultará pero no romperá`);
        }
        preloaded[idx] = v;
      });
      await Promise.all(promises);
      // Elegir primer vídeo con datos válidos
      for (let i = 0; i < preloaded.length; i++) {
        if (preloaded[i] && preloaded[i].videoWidth > 0) {
          activeVideo = preloaded[i];
          currentClipIdx = i;
          break;
        }
      }
      if (!activeVideo && preloaded[0]) {
        activeVideo = preloaded[0];
        currentClipIdx = 0;
      }
    };

    const start = performance.now();
    preloadAll().then(() => {
      // Primer frame inmediato para no grabar negro inicial
      const drawOnce = () => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        if (activeVideo && activeVideo.videoWidth > 0) {
          try {
            const s = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
            ctx.drawImage(activeVideo, (width - activeVideo.videoWidth * s) / 2, (height - activeVideo.videoHeight * s) / 2, activeVideo.videoWidth * s, activeVideo.videoHeight * s);
          } catch {}
        }
      };
      drawOnce();
      const drawLoop = () => {
        if (isFinished) return;
        frameId = requestAnimationFrame(drawLoop);
        const now = performance.now();
        const delta = now - lastDrawTime;
        if (delta >= frameInterval) {
          lastDrawTime = now - (delta % frameInterval);
          const elapsed = (now - start) / 1000;
          onProgress(Math.min(100, (elapsed / actualDuration) * 100));
          if (elapsed >= actualDuration) { stopRecording(); return; }
          const neededIdx = Math.min(clips.length - 1, Math.floor(elapsed / clipDur));
          if (neededIdx !== currentClipIdx) {
            const cand = preloaded[neededIdx];
            if (cand && cand.readyState >= 1 && cand.videoWidth > 0) {
              activeVideo = cand;
              currentClipIdx = neededIdx;
              if (cand.paused) cand.play().catch(() => {});
            }
          }
          // Auto-reanudar vídeo si se pausó (evita negro con varios clips)
          if (activeVideo && activeVideo.paused && !isFinished && activeVideo.readyState >= 2) {
            activeVideo.play().catch(() => {});
          }
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
          if (activeVideo && activeVideo.readyState >= 1 && activeVideo.videoWidth > 0 && activeVideo.videoHeight > 0) {
            try {
              const scale = Math.max(width / activeVideo.videoWidth, height / activeVideo.videoHeight);
              const dw = activeVideo.videoWidth * scale;
              const dh = activeVideo.videoHeight * scale;
              ctx.drawImage(activeVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
            } catch (e) {
              console.warn("[DRAW] fallo", e);
            }
          } else if (activeVideo) {
            try { ctx.drawImage(activeVideo, 0, 0, width, height); } catch {}
          } else {
            ctx.fillStyle = "#111";
            ctx.fillRect(0, 0, width, height);
          }
          if (mode === "voice" && dynamicCues.length > 0) {
            const cue = dynamicCues.find(c => elapsed >= c.start && elapsed < c.end);
            if (cue?.text) {
              ctx.font = '900 22px "Inter", sans-serif';
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.lineJoin = "round";
              ctx.lineWidth = 5;
              ctx.strokeStyle = "#000";
              ctx.fillStyle = "#FFE600";
              drawWrappedText(ctx, cue.text, width / 2, height * 0.72, 220);
            }
          }
        }
      };
      drawLoop();
      // Sin silencio extra: para justo al terminar la voz
      setTimeout(stopRecording, (actualDuration + 0.6) * 1000);
    });
  });
}
