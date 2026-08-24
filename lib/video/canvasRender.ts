/**
 * RENDER — dibuja el VÍDEO REAL del usuario (ajuste "cover") sobre un canvas,
 * reproduciendo únicamente los MOMENTOS VIRALES (segmentos) y superponiendo
 * los subtítulos. Captura con MediaRecorder (mp4 en iPhone). Sin pantalla de
 * colores ni marca de agua: el resultado es el vídeo del usuario, no la app.
 */
import type { SubtitleCue, SubtitleStyle } from "@/types";
import type { NichePalette } from "@/lib/niche";
import type { Segment } from "@/lib/video/highlights";

export interface CaptionVideoOptions {
  durationSec: number;
  audioBlob: Blob | null;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  palette: NichePalette;
  width?: number;
  height?: number;
  fps?: number;
  signal?: AbortSignal;
  onPct?: (pctInBand: number) => void;
  /** Vídeo fuente del usuario (obligatorio salvo en tests). */
  videoBlob?: Blob | null;
  /** Momentos a usar, en segundos. Si falta, se usa el vídeo completo. */
  segments?: Segment[];
  /** Recorta ~5% de cada borde para eliminar marcas de agua de esquina. */
  removeWatermark?: boolean;
}

export interface CaptionVideoResult {
  blob: Blob;
  url: string;
  mime: string;
  ext: string;
  thumbnail: string;
}

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

export async function renderCaptionsVideo(opts: CaptionVideoOptions): Promise<CaptionVideoResult> {
  const {
    durationSec,
    audioBlob,
    cues,
    style,
    palette,
    width = 720,
    height = 1280,
    fps = 30,
    signal,
    onPct,
    videoBlob,
    segments,
    removeWatermark,
  } = opts;

  if (typeof document === "undefined") throw new Error("El render necesita navegador");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false });
  if (!g) throw new Error("Canvas no disponible");

  // ── Vídeo fuente ──────────────────────────────────────────────────────
  const segList = segments && segments.length ? segments : [{ start: 0, end: durationSec }];
  const totalSec = segList.reduce((a, s) => a + (s.end - s.start), 0) || durationSec;
  let video: HTMLVideoElement | null = null;
  let videoUrl: string | null = null;
  if (videoBlob) {
    videoUrl = URL.createObjectURL(videoBlob);
    video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    // iOS exige el elemento en el DOM para reproducir de forma programática
    video.style.cssText =
      "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;";
    try {
      document.body.appendChild(video);
    } catch {}
    try {
      await new Promise<void>((res) => {
        const t = setTimeout(res, 8000);
        video!.onloadeddata = () => {
          clearTimeout(t);
          res();
        };
        video!.onerror = () => {
          clearTimeout(t);
          res();
        };
      });
    } catch {}
  }

  // ── Audio mezclado en vivo ────────────────────────────────────────────
  const AC: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let actx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  if (audioBlob && typeof AC !== "undefined") {
    try {
      actx = new AC();
      await ensureRunning(actx);
      dest = actx.createMediaStreamDestination();
      const ab = await audioBlob.arrayBuffer();
      const buf = await actx.decodeAudioData(ab.slice(0));
      const src = actx.createBufferSource();
      src.buffer = buf;
      const gain = actx.createGain();
      gain.gain.value = 1;
      src.connect(gain).connect(dest);
      src.start();
    } catch {
      dest = null;
    }
  }

  const vStream = canvas.captureStream(fps);
  const tracks: MediaStreamTrack[] = [...vStream.getVideoTracks()];
  if (dest) tracks.push(...dest.stream.getAudioTracks());
  const stream = new MediaStream(tracks);
  const { mime, ext } = pickMime();
  const chunks: BlobPart[] = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startedAt = performance.now();
  let rafId = 0;
  let stopped = false;
  let curSeg = -1;

  const drawVideo = () => {
    if (!video || video.readyState < 2) {
      g.fillStyle = "#0B0D14";
      g.fillRect(0, 0, width, height);
      return;
    }
    drawCover(g, video, width, height, removeWatermark);
  };

  const drawFrame = () => {
    if (stopped) return;
    const t = (performance.now() - startedAt) / 1000;
    if (t >= totalSec) {
      finish();
      return;
    }
    // ¿en qué segmento estamos?
    let acc = 0;
    let segIdx = 0;
    for (let i = 0; i < segList.length; i++) {
      const len = segList[i].end - segList[i].start;
      if (t < acc + len) {
        segIdx = i;
        break;
      }
      acc += len;
    }
    const local = t - acc;
    const seg = segList[segIdx];
    const want = seg.start + local;
    if (video) {
      if (segIdx !== curSeg) {
        curSeg = segIdx;
        try {
          video.currentTime = want;
          const p = video.play();
          if (p && p.catch) p.catch(() => {});
        } catch {}
      } else if (Math.abs((video.currentTime || 0) - want) > 0.3) {
        try {
          video.currentTime = want;
        } catch {}
      }
      drawVideo();
    } else {
      g.fillStyle = "#0B0D14";
      g.fillRect(0, 0, width, height);
    }
    const cue = cues.find((c) => t >= c.start && t < c.end) || null;
    if (cue) drawCue(g, canvas, cue, t, style, palette);
    onPct?.(Math.min(100, (t / totalSec) * 100));
    rafId = requestAnimationFrame(drawFrame);
  };

  let done: (r: CaptionVideoResult) => void;
  let fail: (e: unknown) => void;
  const finished = new Promise<CaptionVideoResult>((res, rej) => {
    done = res;
    fail = rej;
  });

  const finish = () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {}
  };

  rec.onstop = async () => {
    try {
      tracks.forEach((tr) => tr.stop());
      try {
        video?.pause();
      } catch {}
      try {
        if (video && video.parentElement) video.parentElement.removeChild(video);
      } catch {}
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      try {
        await actx?.close();
      } catch {}
      const type = mime.split(";")[0] || "video/webm";
      const blob = new Blob(chunks, { type });
      const url = URL.createObjectURL(blob);
      const thumbnail = capturePoster(canvas);
      done({ blob, url, mime: type, ext, thumbnail });
    } catch (err) {
      fail!(err);
    }
  };
  rec.onerror = (e) => {
    stopped = true;
    cancelAnimationFrame(rafId);
    fail!(new Error(`Grabación fallida: ${(e as unknown as Error).message ?? ""}`));
  };

  const onAbort = () => finish();
  signal?.addEventListener("abort", onAbort, { once: true });

  rec.start(250);
  rafId = requestAnimationFrame(drawFrame);

  return finished.finally(() => signal?.removeEventListener("abort", onAbort));
}

// ── Pintado ─────────────────────────────────────────────────────────────

function drawCover(
  g: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  w: number,
  h: number,
  removeWatermark?: boolean
): void {
  const vw = v.videoWidth || w;
  const vh = v.videoHeight || h;
  if (!vw || !vh) {
    g.fillStyle = "#0B0D14";
    g.fillRect(0, 0, w, h);
    return;
  }
  if (removeWatermark) {
    // Recorta ~5% de cada borde (origen) para ocultar marcas de esquina tipo
    // TikTok, y lo estira a todo el lienzo (cover).
    const mw = vw * 0.05;
    const mh = vh * 0.05;
    g.drawImage(v, mw, mh, vw - 2 * mw, vh - 2 * mh, 0, 0, w, h);
    return;
  }
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  g.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawCue(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cue: SubtitleCue,
  t: number,
  style: SubtitleStyle,
  pal: NichePalette
): void {
  const w = canvas.width;
  const h = canvas.height;
  const lines = cue.text.split("\n");

  let fontSize = Math.round(style.size * (w / 1080));
  g.font = `${style.weight} ${fontSize}px Inter, system-ui, sans-serif`;
  const longest = Math.max(...lines.map((l) => measureWithEmoji(g, l)));
  const maxW = w * style.maxWidth;
  if (longest > maxW) {
    fontSize = Math.max(30, Math.floor((fontSize * maxW) / longest));
    g.font = `${style.weight} ${fontSize}px Inter, system-ui, sans-serif`;
  }

  const age = t - cue.start;
  let scale = 1;
  if (age < 0.16) scale = 0.92 + 0.08 * (age / 0.16) * 1.08;

  const lineH = fontSize * 1.22;
  const blockH = lineH * lines.length;
  const baseY = style.position === "bottom" ? h * 0.82 - blockH : h * 0.42 - blockH / 2;

  g.save();
  g.translate(w / 2, baseY + blockH / 2);
  g.scale(scale, scale);
  g.translate(-w / 2, -(baseY + blockH / 2));
  g.textAlign = "left";
  g.textBaseline = "middle";

  let wordIdx = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].split(" ");
    const lineWidth = measureWithEmoji(g, lines[li]);
    let x = (w - lineWidth) / 2;
    const y = baseY + li * lineH + lineH / 2;
    for (const token of line) {
      const isWord = /\p{L}|\p{N}/u.test(token);
      const hi = isWord && cue.highlight?.[wordIdx] === true;
      const active = isWord && cue.words[wordIdx] && t >= cue.words[wordIdx].start && t < cue.words[wordIdx].end;
      const tw = g.measureText(token + " ").width;
      if (style.stroke) {
        g.lineWidth = Math.max(3, fontSize * 0.09);
        g.strokeStyle = style.strokeColor;
        g.lineJoin = "round";
        g.strokeText(token, x, y);
      }
      if (style.shadow) {
        g.shadowColor = "rgba(0,0,0,0.65)";
        g.shadowBlur = fontSize * 0.12;
        g.shadowOffsetY = 2;
      }
      g.fillStyle = hi && active ? "#FFFFFF" : active || hi ? pal.activeColor : style.color;
      g.fillText(token, x, y);
      x += tw;
      if (isWord) wordIdx++;
    }
  }
  g.restore();
}

function measureWithEmoji(g: CanvasRenderingContext2D, text: string): number {
  return g.measureText(text).width + 6 * (text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0);
}

function capturePoster(canvas: HTMLCanvasElement): string {
  try {
    const mini = document.createElement("canvas");
    mini.width = 360;
    mini.height = Math.round((canvas.height / canvas.width) * 360);
    const mg = mini.getContext("2d");
    if (mg) mg.drawImage(canvas, 0, 0, mini.width, mini.height);
    return mini.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}
