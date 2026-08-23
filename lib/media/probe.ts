/**
 * ANÁLISIS DE VÍDEOS SUBIDOS (100% local, sin subidas a ningún servidor).
 * · analyzeVideoFile: duración, resolución, FPS estimado, orientación, audio.
 * · Helpers puros exportados para tests (orientationOf, nearestFps).
 */

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  orientation: "vertical" | "horizontal" | "cuadrado";
  hasAudio: boolean | null; // null = no determinable
  name: string;
  sizeBytes: number;
}

export function orientationOf(w: number, h: number): VideoProbe["orientation"] {
  if (!w || !h) return "vertical";
  const r = w / h;
  if (r > 1.15) return "horizontal";
  if (r >= 0.87) return "cuadrado";
  return "vertical";
}

export function nearestFps(x: number): number {
  const known = [24, 25, 30, 50, 60];
  let best = 30;
  let bestD = Infinity;
  for (const k of known) {
    const d = Math.abs(k - x);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

interface VideoWithAudioFlags extends HTMLVideoElement {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
}

/**
 * Analiza un File de vídeo en el navegador. Abortable y con timeout duro.
 */
export async function analyzeVideoFile(
  file: File,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<VideoProbe> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video") as VideoWithAudioFlags;
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;

  const cleanup = () => URL.revokeObjectURL(url);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("El vídeo tardó demasiado en analizarse")),
        timeoutMs
      );
      const onAbort = () => reject(new DOMException("cancelado", "AbortError"));
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        reject(new Error("No se pudo leer el vídeo (formato no soportado)"));
      };
      video.src = url;
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth;
    const height = video.videoHeight;

    // FPS estimado con requestVideoFrameCallback si existe
    let fps: number | null = null;
    const rVFC = (
      video as unknown as {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      }
    ).requestVideoFrameCallback?.bind(video);
    if (rVFC && duration > 0.5) {
      fps = await estimateFps(video, rVFC, Math.min(2, duration / 4), opts.signal).catch(() => null);
    }

    const hasAudio =
      typeof video.mozHasAudio === "boolean"
        ? video.mozHasAudio
        : typeof video.webkitAudioDecodedByteCount === "number" && video.webkitAudioDecodedByteCount > 0
          ? true
          : video.audioTracks
            ? video.audioTracks.length > 0
            : null;

    return {
      duration,
      width,
      height,
      fps: fps != null ? nearestFps(fps) : null,
      orientation: orientationOf(width, height),
      hasAudio,
      name: file.name,
      sizeBytes: file.size,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    cleanup();
  }
}

async function estimateFps(
  video: HTMLVideoElement,
  rVFC: (cb: (now: number, meta: { mediaTime: number }) => void) => number,
  windowSec: number,
  signal?: AbortSignal
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let frames = 0;
    let t0: number | null = null;
    const onAbort = () => {
      video.pause();
      reject(new DOMException("cancelado", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const step = (_now: number, meta: { mediaTime: number }) => {
      if (t0 === null) t0 = meta.mediaTime;
      frames++;
      if (meta.mediaTime - t0 >= windowSec) {
        video.pause();
        signal?.removeEventListener("abort", onAbort);
        resolve(frames / Math.max(0.05, meta.mediaTime - t0));
        return;
      }
      try {
        rVFC(step);
      } catch {
        signal?.removeEventListener("abort", onAbort);
        resolve(frames / Math.max(0.05, meta.mediaTime - t0));
      }
    };
    video.currentTime = 0;
    video.play().then(() => rVFC(step)).catch(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(30);
    });
    setTimeout(() => {
      video.pause();
      signal?.removeEventListener("abort", onAbort);
      resolve(frames > 3 && t0 !== null ? frames / Math.max(0.05, windowSec) : 30);
    }, (windowSec + 2.5) * 1000);
  });
}
