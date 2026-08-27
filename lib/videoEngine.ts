import { RenderConfig, SubtitleCue } from "@/types";

const CANVAS_STYLE =
  "position:fixed;left:-10000px;top:-10000px;width:270px;height:480px;pointer-events:none;";

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
) {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 0) return;

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine
      ? `${currentLine} ${word}`
      : word;

    if (
      ctx.measureText(testLine).width > maxWidth &&
      currentLine
    ) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  const lineHeight = 30;
  const startY =
    y - ((lines.length - 1) * lineHeight) / 2;

  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;

    ctx.strokeText(lines[i], x, lineY);
    ctx.fillText(lines[i], x, lineY);
  }
}

function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  return "";
}

function getExtensionFromMimeType(mime: string): string {
  return mime.toLowerCase().includes("mp4")
    ? "mp4"
    : "webm";
}

function createVideoElement(
  clipUrl: string
): HTMLVideoElement {
  const video = document.createElement("video");

  video.src = clipUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.style.cssText = CANVAS_STYLE;

  document.body.appendChild(video);

  return video;
}

async function waitForVideoReady(
  video: HTMLVideoElement
): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("canplay", onLoaded);
      video.removeEventListener("error", onError);
    };

    const done = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve();
    };

    const onLoaded = () => {
      done();
    };

    const onError = () => {
      if (finished) return;

      finished = true;
      cleanup();

      reject(
        new Error("No se pudo cargar uno de los vídeos.")
      );
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("canplay", onLoaded);
    video.addEventListener("error", onError);

    video.load();

    setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        done();
      } else {
        onError();
      }
    }, 10000);
  });
}

async function seekVideoSafely(
  video: HTMLVideoElement,
  position: number
): Promise<void> {
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }

  const maxPosition = Math.max(
    0,
    video.duration - 0.05
  );

  const safePosition = Math.max(
    0,
    Math.min(position, maxPosition)
  );

  if (Math.abs(video.currentTime - safePosition) < 0.03) {
    return;
  }

  await new Promise<void>((resolve) => {
    let finished = false;

    const done = () => {
      if (finished) return;

      finished = true;
      video.removeEventListener("seeked", done);
      resolve();
    };

    video.addEventListener("seeked", done);

    try {
      video.currentTime = safePosition;
    } catch {
      done();
    }

    setTimeout(done, 1000);
  });
}

export async function renderFinalVideo(
  config: RenderConfig
): Promise<{
  url: string;
  mimeType: string;
  extension: string;
}> {
  const {
    clips,
    audioBlob,
    targetDuration,
    mode,
    wordChunks,
    onProgress,
  } = config;

  if (!clips.length) {
    throw new Error(
      "No hay vídeos para renderizar."
    );
  }

  const width = 270;
  const height = 480;
  const FPS = 30;

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = CANVAS_STYLE;

  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d", {
    alpha: false,
  });

  if (!ctx) {
    canvas.remove();
    throw new Error(
      "Tu navegador no soporta Canvas 2D."
    );
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let audioContext: AudioContext | null = null;
  let audioDestination:
    | MediaStreamAudioDestinationNode
    | null = null;

  let activeVideo: HTMLVideoElement | null = null;

  try {
    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new Error(
        "Tu navegador no soporta AudioContext."
      );
    }

    audioContext = new AudioContextConstructor();

    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }

    audioDestination =
      audioContext.createMediaStreamDestination();

    let actualDuration = Math.max(
      1,
      targetDuration || 10
    );

    if (audioBlob) {
      const audioArrayBuffer =
        await audioBlob.arrayBuffer();

      const decoded =
        await audioContext.decodeAudioData(
          audioArrayBuffer.slice(0)
        );

      if (!decoded.duration || decoded.duration <= 0) {
        throw new Error(
          "La voz generada no tiene una duración válida."
        );
      }

      if (mode === "voice") {
        actualDuration = decoded.duration;
      }

      const source =
        audioContext.createBufferSource();

      source.buffer = decoded;

      if (mode === "music") {
        source.loop = true;
      }

      source.connect(audioDestination);
      source.start(0);
    }

    const dynamicCues: SubtitleCue[] = [];

    if (
      mode === "voice" &&
      wordChunks.length > 0
    ) {
      const totalWeight = wordChunks.reduce(
        (total, chunk) =>
          total +
          Math.max(
            1,
            chunk.replace(/\s+/g, "").length
          ),
        0
      );

      let currentTime = 0;

      for (const chunk of wordChunks) {
        const weight = Math.max(
          1,
          chunk.replace(/\s+/g, "").length
        );

        const duration =
          (weight / totalWeight) *
          actualDuration;

        dynamicCues.push({
          text: chunk,
          start: currentTime,
          end: currentTime + duration,
        });

        currentTime += duration;
      }
    }

    const captureStream =
      canvas.captureStream(FPS);

    if (audioDestination) {
      const audioTracks =
        audioDestination.stream.getAudioTracks();

      for (const track of audioTracks) {
        captureStream.addTrack(track);
      }
    }

    const selectedMime =
      getSupportedMimeType();

    if (
      !selectedMime &&
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error(
        "Tu navegador no soporta grabación de vídeo."
      );
    }

    let recorder: MediaRecorder;

    try {
      recorder = selectedMime
        ? new MediaRecorder(captureStream, {
            mimeType: selectedMime,
            videoBitsPerSecond: 2_500_000,
          })
        : new MediaRecorder(captureStream);
    } catch {
      recorder = new MediaRecorder(
        captureStream
      );
    }

    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (
        event.data &&
        event.data.size > 0
      ) {
        chunks.push(event.data);
      }
    };

    const mimeType =
      recorder.mimeType ||
      selectedMime ||
      "video/webm";

    const clipDuration =
      actualDuration / Math.max(1, clips.length);

    let currentClipIndex = -1;

    const loadClip = async (
      index: number,
      elapsed: number
    ) => {
      const clip =
        clips[index % clips.length];

      const newVideo =
        createVideoElement(clip.url);

      await waitForVideoReady(newVideo);

      const startOffset = Math.max(
        0,
        Math.min(
          clip.startOffset || 0,
          Math.max(
            0,
            newVideo.duration - 0.05
          )
        )
      );

      let randomOffset = 0;

      if (
        Number.isFinite(newVideo.duration) &&
        newVideo.duration > 0.1
      ) {
        const available =
          Math.max(
            0,
            newVideo.duration -
              Math.min(
                clipDuration,
                newVideo.duration
              )
          );

        randomOffset =
          Math.random() * available;
      }

      await seekVideoSafely(
        newVideo,
        Math.max(
          startOffset,
          randomOffset
        )
      );

      await newVideo.play().catch(() => {});

      const oldVideo = activeVideo;

      activeVideo = newVideo;
      currentClipIndex = index;

      if (oldVideo) {
        oldVideo.pause();
        oldVideo.removeAttribute("src");
        oldVideo.load();
        oldVideo.remove();
      }

      void elapsed;
    };

    await loadClip(0, 0);

    let recordingStarted = false;
    let finished = false;
    let animationFrame = 0;

    const startedAt =
      performance.now();

    const cleanup = () => {
      cancelAnimationFrame(
        animationFrame
      );

      if (activeVideo) {
        activeVideo.pause();
        activeVideo.removeAttribute(
          "src"
        );
        activeVideo.load();
        activeVideo.remove();
        activeVideo = null;
      }

      for (const clip of clips) {
        URL.revokeObjectURL(clip.url);
      }

      try {
        captureStream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      } catch {}


      canvas.remove();

      if (audioContext) {
        void audioContext
          .close()
          .catch(() => {});
      }
    };

    return await new Promise<{
      url: string;
      mimeType: string;
      extension: string;
    }>((resolve, reject) => {
      const finish = () => {
        if (finished) return;

        finished = true;

        try {
          if (
            recorder.state === "recording"
          ) {
            recorder.stop();
          }
        } catch {}


        setTimeout(() => {
          if (!chunks.length) {
            cleanup();

            reject(
              new Error(
                "No se capturaron fotogramas del vídeo."
              )
            );

            return;
          }

          const finalBlob = new Blob(
            chunks,
            {
              type: mimeType,
            }
          );

          const url =
            URL.createObjectURL(
              finalBlob
            );

          cleanup();

          resolve({
            url,
            mimeType,
            extension:
              getExtensionFromMimeType(
                mimeType
              ),
          });
        }, 250);
      };

      recorder.onerror = () => {
        cleanup();

        reject(
          new Error(
            "El navegador produjo un error al grabar el vídeo."
          )
        );
      };

      recorder.onstop = () => {
        if (!finished) {
          finish();
        }
      };

      try {
        recorder.start(250);
        recordingStarted = true;
      } catch {
        cleanup();

        reject(
          new Error(
            "No se pudo iniciar la grabación del vídeo."
          )
        );

        return;
      }

      const draw = () => {
        if (finished) return;

        const now =
          performance.now();

        const elapsed =
          (now - startedAt) / 1000;

        if (
          elapsed >= actualDuration
        ) {
          onProgress(100);
          finish();
          return;
        }

        const progress =
          Math.min(
            99,
            Math.round(
              (elapsed /
                actualDuration) *
                100
            )
          );

        onProgress(progress);

        const desiredClipIndex =
          Math.min(
            clips.length - 1,
            Math.floor(
              elapsed /
                clipDuration
            )
          );

        if (
          desiredClipIndex !==
            currentClipIndex &&
          desiredClipIndex <
            clips.length
        ) {
          void loadClip(
            desiredClipIndex,
            elapsed
          );
        }

        ctx.fillStyle = "#000";
        ctx.fillRect(
          0,
          0,
          width,
          height
        );

        if (
          activeVideo &&
          activeVideo.readyState >=
            HTMLMediaElement.HAVE_CURRENT_DATA &&
          activeVideo.videoWidth > 0 &&
          activeVideo.videoHeight > 0
        ) {
          const scale =
            Math.max(
              width /
                activeVideo.videoWidth,
              height /
                activeVideo.videoHeight
            );

          const drawWidth =
            activeVideo.videoWidth *
            scale;

          const drawHeight =
            activeVideo.videoHeight *
            scale;

          ctx.drawImage(
            activeVideo,
            (width -
              drawWidth) /
              2,
            (height -
              drawHeight) /
              2,
            drawWidth,
            drawHeight
          );
        }

        if (
          mode === "voice" &&
          dynamicCues.length
        ) {
          const cue =
            dynamicCues.find(
              (item) =>
                elapsed >=
                  item.start &&
                elapsed <
                  item.end
            );

          if (cue) {
            ctx.font =
              '900 24px Arial, sans-serif';

            ctx.textAlign =
              "center";

            ctx.textBaseline =
              "middle";

            ctx.lineJoin =
              "round";

            ctx.lineWidth = 5;
            ctx.strokeStyle =
              "#000";
            ctx.fillStyle =
              "#FFE600";

            drawWrappedText(
              ctx,
              cue.text,
              width / 2,
              height * 0.7,
              220
            );
          }
        }

        animationFrame =
          requestAnimationFrame(
            draw
          );
      };

      if (recordingStarted) {
        animationFrame =
          requestAnimationFrame(
            draw
          );
      }

      setTimeout(
        () => {
          if (!finished) {
            finish();
          }
        },
        (actualDuration + 2) *
          1000
      );
    });
  } catch (error) {
    if (activeVideo) {
      const av = activeVideo as HTMLVideoElement;
      av.pause();
      av.removeAttribute("src");
      av.load();
      av.remove();
    }

    canvas.remove();

    if (audioContext) {
      await audioContext
        .close()
        .catch(() => {});
    }

    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido durante el renderizado.";

    throw new Error(message);
  }
}
