/**
 * UNE varios vídeos subidos en uno solo (reproducción secuencial + audio
 * original). El resultado se trata como un vídeo único: el detector de momentos
 * virales ya elige los mejores tramos sobre la línea de tiempo unida.
 */
function pickMime(): { mime: string; ext: string } {
  const candidates: Array<[string, string]> = [
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  for (const [mime, ext] of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
    } catch {}
  }
  return { mime: "", ext: "webm" };
}

async function ensureRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {}
  }
}

function drawCover(g: CanvasRenderingContext2D, v: HTMLVideoElement, w: number, h: number): void {
  const vw = v.videoWidth || w;
  const vh = v.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  g.drawImage(v, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
}

export async function mergeVideos(
  blobs: Blob[],
  opts: { signal?: AbortSignal; width?: number; height?: number } = {}
): Promise<Blob> {
  if (blobs.length === 0) throw new Error("No hay vídeos");
  // Siempre pasamos por canvas para quitar audio original (petición usuario: siempre sin audio)
  const width = opts.width ?? 720;
  const height = opts.height ?? 1280;
  if (typeof document === "undefined") return blobs[0];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false });
  if (!g) return blobs[0];

  // Siempre sin audio original (petición usuario: quitar audios de videos subidos)
  const vStream = canvas.captureStream(30);
  const tracks: MediaStreamTrack[] = [...vStream.getVideoTracks()];
  const stream = new MediaStream(tracks);
  const { mime, ext } = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const finished = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => {
      try {
        const blob = new Blob(chunks, { type: mime.split(";")[0] || "video/webm" });
        resolve(blob);
      } catch (e) {
        reject(e);
      }
    };
    rec.onerror = () => reject(new Error("Fallo al unir vídeos"));
  });

  rec.start(250);

  try {
    for (const blob of blobs) {
      if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;";
      document.body.appendChild(video);

      await new Promise<void>((res, rej) => {
        const onErr = () => rej(new Error("Vídeo no reproducible"));
        video.onerror = onErr;
        video.onloadeddata = () => res();
        setTimeout(() => res(), 8000);
      });

      await new Promise<void>((res) => {
        let raf = 0;
        const stop = () => {
          cancelAnimationFrame(raf);
          video.removeEventListener("ended", stop);
          res();
        };
        video.addEventListener("ended", stop);
        const playP = video.play();
        if (playP && playP.catch) playP.catch(() => {});
        const tick = () => {
          if (video.readyState >= 2) drawCover(g, video, width, height);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });

      try {
        video.pause();
      } catch {}
      try {
        if (video.parentElement) video.parentElement.removeChild(video);
      } catch {}
      URL.revokeObjectURL(url);
    }
  } finally {
    if (rec.state !== "inactive") rec.stop();
  }

  return finished;
}
