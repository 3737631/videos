/**
 * RENDER V3 — un solo motor multiplataforma (Safari iPhone incluido):
 * Canvas animado + captura de stream + MediaRecorder con audio MEZCLADO.
 * Sin FFmpeg gigante en móvil, sin workers extra, memoria liberada al terminar.
 */
import type { SubtitleCue, SubtitleStyle } from "@/types";
import type { NichePalette } from "@/lib/niche";

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

/** Safari exige AudioContext tras gesto de usuario; resume() defensivo */
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
  } = opts;

  if (typeof document === "undefined") throw new Error("El render necesita navegador");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { alpha: false });
  if (!g) throw new Error("Canvas no disponible");

  // ── Audio: mezclar en vivo hacia el stream del recorder ──────────────
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

  const drawFrame = () => {
    if (stopped) return;
    const t = (performance.now() - startedAt) / 1000;
    drawBackground(g, width, height, t, palette);
    drawWatermark(g, width, height);
    const cue = cues.find((c) => t >= c.start && t < c.end) || null;
    if (cue) drawCue(g, canvas, cue, t, style, palette);
    onPct?.(Math.min(100, (t / durationSec) * 100));
    if (t >= durationSec) {
      finish();
      return;
    }
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

function drawBackground(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  pal: NichePalette
): void {
  g.fillStyle = "#0B0D14";
  g.fillRect(0, 0, w, h);
  const blob = (cx: number, cy: number, r: number, color: string, alpha: number) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, hexA(color, alpha));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  };
  const s = Math.min(w, h);
  blob(
    w * (0.5 + 0.35 * Math.sin(t * 0.6)),
    h * (0.3 + 0.18 * Math.cos(t * 0.45)),
    s * 0.75,
    pal.activeColor,
    0.22
  );
  blob(
    w * (0.5 + 0.4 * Math.cos(t * 0.37 + 2)),
    h * (0.7 + 0.15 * Math.sin(t * 0.52 + 1)),
    s * 0.8,
    pal.accent,
    0.2
  );
  // grano suave para vida visual
  g.globalAlpha = 0.03;
  for (let i = 0; i < 40; i++) {
    const x = ((i * 977) % w) + Math.sin(t * 2 + i) * 2;
    const y = ((i * 613) % h);
    g.fillRect(x, y, 2, 2);
  }
  g.globalAlpha = 1;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawWatermark(g: CanvasRenderingContext2D, w: number, _h: number): void {
  g.save();
  g.font = "600 26px Inter, system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.textAlign = "center";
  g.fillText("✦ ClipCraft", w / 2, 64);
  g.restore();
}

function wrapTwoLines(text: string): string[] {
  const parts = text.split("\n");
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(" ")];
  return [text];
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
  const lines = wrapTwoLines(cue.text);

  // tamaño adaptativo: que la línea más larga quepe ~86% del ancho
  let fontSize = Math.round(style.size * (w / 1080));
  g.font = `${style.weight} ${fontSize}px Inter, system-ui, sans-serif`;
  const longest = Math.max(...lines.map((l) => measureWithEmoji(g, l)));
  const maxW = w * style.maxWidth;
  if (longest > maxW) {
    fontSize = Math.max(30, Math.floor((fontSize * maxW) / longest));
    g.font = `${style.weight} ${fontSize}px Inter, system-ui, sans-serif`;
  }

  // pop de entrada
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
      g.fillStyle =
        hi && active ? "#FFFFFF" : active || hi ? pal.activeColor : style.color;
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
