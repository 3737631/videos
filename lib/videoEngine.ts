import { RenderConfig } from "@/types";

const CANVAS_CSS =
  "position:absolute;top:0;left:0;width:270px;height:480px;opacity:0.001;pointer-events:none;z-index:-100;";

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): void {
  const words = text.split(" ");
  let line = "";
  const lines: string[] = [];
  const lineHeight = 30;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + " ";
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

function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];

  for (const mime of candidates) {
    try {
      if (
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(mime)
      ) {
        return mime;
      }
    } catch {
      // ignore
    }
  }

  return "";
}

export async function renderFinalVideo(
  config: RenderConfig
): Promise<string> {
  const { clips, audioBlob, wordChunks, mode, targetDuration, onProgress } =
    config;

  if (!clips || clips.length === 0) {
    throw new Error("No hay clips de vídeo para renderizar.");
  }

  if (typeof MediaRecorder === "undefined") {
    throw new Error(
      "Tu navegador no soporta grabación de vídeo. Prueba con Chrome o Safari actualizado."
    );
  }

  const width = 270;
  const height = 480;
  const FPS = 30;
  const frameInterval = 1000 / FPS;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = CANVAS_CSS;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });

  if (!ctx) {
    canvas.remove();
    throw new Error("Tu navegador no soporta Canvas 2D.");
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let audioCtx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let actualDuration = Math.max(1, targetDuration || 10);
  let dynamicCues: { text: string; start: number; end: number }[] = [];
  const createdVideos: HTMLVideoElement[] = [];
  let finalStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;

  const cleanup = (): void => {
    try {
      if (audioSource) {
        try {
          audioSource.stop();
        } catch {}
        try {
          audioSource.disconnect();
        } catch {}
        audioSource = null;
      }
    } catch {}

    for (const video of createdVideos) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      } catch {}
    }
    createdVideos.length = 0;

    try {
      if (finalStream) {
        for (const track of finalStream.getTracks()) {
          try {
            track.stop();
          } catch {}
        }
      }
    } catch {}

    try {
      if (canvas.parentNode) canvas.remove();
    } catch {}
    canvas.width = 0;

    try {
      if (audioCtx && audioCtx.state !== "closed") {
        void audioCtx.close();
      }
    } catch {}
  };

  try {
    const AudioContextClass =
      (window as unknown as { AudioContext: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("AudioContext no soportado en este navegador.");
    }

    audioCtx = new AudioContextClass();

    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch {}
    }

    dest = audioCtx.createMediaStreamDestination();

    const osc = audioCtx.createOscillator();
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0.01;
    osc.connect(silentGain);
    silentGain.connect(dest);
    osc.start();

    if (audioBlob) {
      const arrayBuffer = await audioBlob.arrayBuffer();
      let decoded: AudioBuffer | null = null;

      try {
        decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      } catch (err) {
        throw new Error(
          "Error al decodificar el audio: " +
            ((err as Error).message || "formato no válido")
        );
      }

      if (decoded && decoded.duration > 0.5) {
        actualDuration = decoded.duration;
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;

        if (mode === "voice") {
          const rawRatio = actualDuration / Math.max(1, targetDuration);
          const clamped = Math.max(0.8, Math.min(rawRatio, 1.8));

          if (rawRatio > 2) {
            actualDuration = decoded.duration / 1.15;
            source.playbackRate.value = 1.15;
          } else {
            source.playbackRate.value = clamped;
            if (clamped !== 1) {
              actualDuration = decoded.duration / clamped;
            }
          }
        } else {
          source.loop = true;
        }

        source.connect(dest);
        source.start(0);
        audioSource = source;
      }
    }

    if (mode === "voice" && wordChunks && wordChunks.length > 0) {
      const timePerChunk = actualDuration / wordChunks.length;
      dynamicCues = wordChunks.map((text, i) => ({
        text: text,
        start: i * timePerChunk,
        end: (i + 1) * timePerChunk,
      }));
    } else if (mode === "voice") {
      const fallback = ["¡MIRA ESTO!", "DESCÚBRELO", "AHORA"];
      const timePerChunk = actualDuration / fallback.length;
      dynamicCues = fallback.map((text, i) => ({
        text,
        start: i * timePerChunk,
        end: (i + 1) * timePerChunk,
      }));
    }

    const canvasWithCapture = canvas as HTMLCanvasElement & {
      captureStream?: (fps: number) => MediaStream;
      mozCaptureStream?: (fps: number) => MediaStream;
      webkitCaptureStream?: (fps: number) => MediaStream;
    };

    const captureFn =
      canvasWithCapture.captureStream?.bind(canvasWithCapture) ||
      canvasWithCapture.mozCaptureStream?.bind(canvasWithCapture) ||
      canvasWithCapture.webkitCaptureStream?.bind(canvasWithCapture);

    if (!captureFn) {
      throw new Error("Tu navegador no soporta captura de vídeo en Canvas.");
    }

    const canvasStream = captureFn(FPS);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    if (dest) {
      tracks.push(...dest.stream.getAudioTracks());
    }

    finalStream = new MediaStream(tracks);

    const selectedMime = getSupportedMimeType();

    try {
      recorder = selectedMime
        ? new MediaRecorder(finalStream, {
            mimeType: selectedMime,
            videoBitsPerSecond: 1_500_000,
          })
        : new MediaRecorder(finalStream);
    } catch {
      recorder = new MediaRecorder(finalStream);
    }

    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    return await new Promise<string>((resolve, reject) => {
      if (!recorder) {
        reject(new Error("No se pudo inicializar el grabador."));
        return;
      }

      let isFinished = false;
      let isResolved = false;
      let currentClipIdx = -1;
      let activeVideo: HTMLVideoElement | null = null;
      let lastDrawTime = performance.now();
      let frameId = 0;
      const loadingIndices = new Set<number>();

      const clipCount = clips.length;
      const clipDur = actualDuration / clipCount;

      const finalize = (): void => {
        if (isResolved) return;
        isResolved = true;
        cancelAnimationFrame(frameId);
        if (activeVideo) {
          try {
            activeVideo.pause();
          } catch {}
          activeVideo = null;
        }
        cleanup();

        if (chunks.length === 0) {
          reject(
            new Error("No se procesó vídeo (Cero fotogramas capturados).")
          );
          return;
        }

        const mimeToUse =
          recorder?.mimeType || selectedMime || "video/webm";
        const blob = new Blob(chunks, { type: mimeToUse });
        resolve(URL.createObjectURL(blob));
      };

      const stopRecording = (): void => {
        if (isFinished) return;
        isFinished = true;
        try {
          if (recorder && recorder.state === "recording") {
            recorder.stop();
          } else {
            finalize();
          }
        } catch {
          finalize();
        }
      };

      recorder.onstop = () => {
        setTimeout(finalize, 200);
      };

      recorder.onerror = () => {
        cleanup();
        reject(new Error("Error interno del grabador de vídeo."));
      };

      const loadVideoAsync = async (index: number): Promise<void> => {
        if (index < 0 || index >= clips.length) return;
        if (loadingIndices.has(index)) return;
        loadingIndices.add(index);

        const clip = clips[index];
        const safeDuration = Math.max(0.5, clip.playDuration || 1);
        const safeStart = Number.isFinite(clip.startOffset)
          ? Math.max(0, Math.min(clip.startOffset, Math.max(0, safeDuration - 0.1)))
          : 0;

        const newVideo = document.createElement("video");
        newVideo.src = clip.url;
        newVideo.muted = true;
        newVideo.playsInline = true;
        newVideo.preload = "auto";
        newVideo.style.cssText = CANVAS_CSS;
        newVideo.crossOrigin = "anonymous";

        try {
          newVideo.currentTime = safeStart;
        } catch {}

        document.body.appendChild(newVideo);
        createdVideos.push(newVideo);

        await new Promise<void>((res) => {
          let resolved = false;
          const done = () => {
            if (resolved) return;
            resolved = true;
            res();
          };
          newVideo.oncanplay = done;
          newVideo.onloadeddata = done;
          newVideo.onerror = done;
          setTimeout(done, 1200);
        });

        if (newVideo.readyState >= 1) {
          try {
            const target =
              safeStart +
              Math.random() * Math.max(0, safeDuration - clipDur - 0.1);
            if (Number.isFinite(target)) newVideo.currentTime = target;
          } catch {}
        }

        try {
          await newVideo.play();
        } catch {}

        const oldVideo = activeVideo;
        activeVideo = newVideo;

        if (oldVideo && oldVideo !== newVideo) {
          try {
            oldVideo.pause();
            oldVideo.removeAttribute("src");
            oldVideo.load();
            oldVideo.remove();
            const idx = createdVideos.indexOf(oldVideo);
            if (idx !== -1) createdVideos.splice(idx, 1);
          } catch {}
        }

        loadingIndices.delete(index);
      };

      recorder.start(250);
      const start = performance.now();

      void (async () => {
        currentClipIdx = 0;
        await loadVideoAsync(0);
      })();

      const drawLoop = (): void => {
        if (isFinished) return;
        frameId = requestAnimationFrame(drawLoop);

        const now = performance.now();
        const delta = now - lastDrawTime;
        if (delta < frameInterval) return;
        lastDrawTime = now - (delta % frameInterval);

        const elapsed = (now - start) / 1000;
        const progress = Math.min(100, (elapsed / actualDuration) * 100);
        try {
          onProgress(progress);
        } catch {}

        if (elapsed >= actualDuration) {
          stopRecording();
          return;
        }

        const activeIdx = Math.min(
          clipCount - 1,
          Math.floor(elapsed / clipDur)
        );

        if (activeIdx !== currentClipIdx) {
          currentClipIdx = activeIdx;
          void loadVideoAsync(activeIdx);
        }

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);

        if (activeVideo && activeVideo.readyState >= 2) {
          const vw = activeVideo.videoWidth || width;
          const vh = activeVideo.videoHeight || height;
          const scale = Math.max(width / vw, height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          ctx.drawImage(
            activeVideo,
            (width - dw) / 2,
            (height - dh) / 2,
            dw,
            dh
          );
        }

        if (mode === "voice" && dynamicCues.length > 0) {
          const cue =
            dynamicCues.find(
              (c) => elapsed >= c.start && elapsed < c.end
            ) ||
            dynamicCues[
              Math.min(
                dynamicCues.length - 1,
                Math.floor((elapsed / actualDuration) * dynamicCues.length)
              )
            ];

          if (cue && cue.text) {
            ctx.font = '900 24px "Inter", sans-serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            ctx.lineWidth = 5;
            ctx.strokeStyle = "#000";
            ctx.fillStyle = "#FFE600";
            drawWrappedText(ctx, cue.text, width / 2, height * 0.7, 200);
          }
        }
      };

      drawLoop();

      setTimeout(stopRecording, (actualDuration + 3) * 1000);
    });
  } catch (err) {
    cleanup();
    throw err;
  }
}
