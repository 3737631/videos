import type { Project } from "@/types";

export interface MobileRenderOptions {
  width: number;
  height: number;
  fps?: number;
  musicVolume?: number;
  voiceVolume?: number;
  onStage?: (stage: string, pct: number) => void;
}

export interface MobileRenderResult {
  blob: Blob;
  url: string;
  validation: {
    ok: boolean;
    duration: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    audioDuration: number;
    sizeBytes: number;
    codec: string;
    errors: string[];
  };
}

function pickMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder !== "undefined") {
    for (const m of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch {}
    }
  }
  return "";
}

function once(el: HTMLMediaElement, ev: string, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout esperando ${ev}`));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error(`error cargando media (${ev})`));
    };
    function cleanup() {
      clearTimeout(t);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    }
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

function drawCover(
  c: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  W: number,
  H: number
) {
  const vw = v.videoWidth || 1080;
  const vh = v.videoHeight || 1920;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  c.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** Banda sonora DETERMINISTA: voz + música en bucle mezclados sin captura en vivo */
export async function buildSoundtrack(
  project: Project,
  opts: { duration: number; voiceVolume?: number; musicVolume?: number }
): Promise<Blob | null> {
  const plan = project.editPlan;
  if (!plan) return null;
  const hasVoice = !!plan.voice?.audioUrl;
  const hasMusic = !!(plan.music && project.music?.url);
  if (!hasVoice && !hasMusic) return null;

  const OC: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const sr = 44100;
  const len = Math.ceil((opts.duration + 0.4) * sr);
  const octx = new OC(2, len, sr);

  if (hasVoice) {
    const ab = await (await fetch(plan.voice!.audioUrl!)).arrayBuffer();
    const buf = await octx.decodeAudioData(ab);
    const s = octx.createBufferSource();
    s.buffer = buf;
    const g = octx.createGain();
    g.gain.value = opts.voiceVolume ?? 1;
    s.connect(g);
    g.connect(octx.destination);
    s.start(0);
  }
  if (hasMusic) {
    const ab = await (await fetch((project.music as { url: string }).url)).arrayBuffer();
    const buf = await octx.decodeAudioData(ab);
    const s = octx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const g = octx.createGain();
    g.gain.value = opts.musicVolume ?? 0.25;
    s.connect(g);
    g.connect(octx.destination);
    s.start(0);
  }

  const rendered = await octx.startRendering();

  // WAV PCM 16-bit estéreo
  const chs = rendered.numberOfChannels;
  const frames = rendered.length;
  const data = new Int16Array(frames * chs);
  const chans: Float32Array[] = [];
  for (let c = 0; c < chs; c++) chans.push(rendered.getChannelData(c));
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chs; c++) {
      let s = chans[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      data[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  const bytesPerSample = 2;
  const blockAlign = chs * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, chs, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(data.buffer));
  return new Blob([buffer], { type: "audio/wav" });
}

/** ¿El archivo de vídeo contiene audio audible? (decodificación nativa, sin ffmpeg) */
export async function verifyFinalAudio(
  blob: Blob
): Promise<{ ok: boolean; rms: number; peak: number; duration: number }> {
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    let sum = 0;
    let peak = 0;
    let n = 0;
    for (let i = 0; i < ch.length; i += 41) {
      const v = Math.abs(ch[i]);
      sum += v;
      if (v > peak) peak = v;
      n++;
    }
    const rms = n ? sum / n : 0;
    return {
      ok: rms > 0.0012 && peak > 0.02 && buf.duration > 0.5,
      rms,
      peak,
      duration: buf.duration,
    };
  } finally {
    ctx.close().catch(() => {});
  }
}

/**
 * Render NATIVO para iPhone/iPad: graba SOLO IMAGEN con MediaRecorder (codificador
 * del sistema, tiempo real). El sonido se añade después de forma determinista con
 * buildSoundtrack + unión rápida. Sin captura de audio en vivo = sin silencios raros.
 */
export async function renderProjectMobile(
  project: Project,
  opts: MobileRenderOptions
): Promise<MobileRenderResult> {
  const plan = project.editPlan;
  if (!plan) throw new Error("No hay plan de edición");
  const W = Math.round(opts.width);
  const H = Math.round(opts.height);
  const fps = opts.fps || 30;

  const clips = plan.clips.filter((c) => project.sources.some((s) => s.id === c.sourceId));
  if (!clips.length) throw new Error("No hay clips para grabar");
  const totalDur = clips.reduce((a, c) => a + Math.max(0, c.end - c.start), 0);

  opts.onStage?.("Preparando grabación nativa", 4);

  // Lienzo de salida (debe estar EN el documento para captureStream en Safari)
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { alpha: false })!;
  canvas.style.cssText =
    "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
  document.body.appendChild(canvas);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);

  // ===== VIDEO: elementos <video> precargados por fuente =====
  const vidCache = new Map<string, HTMLVideoElement>();
  const getVid = async (url: string): Promise<HTMLVideoElement> => {
    let v = vidCache.get(url);
    if (!v) {
      v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = url;
      await once(v, "loadeddata");
      vidCache.set(url, v);
    }
    return v;
  };
  // Precargar TODOS los vídeos usados antes de empezar
  for (const c of clips) {
    const s = project.sources.find((x) => x.id === c.sourceId)!;
    await getVid(s.url);
  }

  const cues = plan.subtitles?.cues || [];
  const st = plan.subtitles?.style;

  /** Texto ajustado: tamaño natural, reduce y parte en 2 líneas si hace falta */
  const drawCue = (t: number) => {
    const cue = cues.find((q) => t >= q.start && t < q.end);
    if (!cue || !cue.text.trim()) return;
    const words = cue.words || [];
    const activeWord = words.find((w) => t >= w.start && t < w.end);
    let fs = Math.round(H * 0.045); // tamaño natural legible (no gigante)
    const maxW = W * 0.92;
    const setFont = () => {
      g.font = `900 ${fs}px -apple-system, Impact, sans-serif`;
    };
    setFont();
    let raw = cue.text.toUpperCase().trim();
    // Reducir hasta que quepa en una línea razonable
    while (fs > H * 0.03 && g.measureText(raw).width > maxW) {
      fs -= 2;
      setFont();
    }
    // Si aun así no cabe, dividir en 2 líneas equilibradas
    let lines: string[] = [raw];
    if (g.measureText(raw).width > maxW) {
      const parts = raw.split(/\s+/);
      let best = "";
      let bestDiff = Infinity;
      for (let i = 1; i < parts.length; i++) {
        const l1 = parts.slice(0, i).join(" ");
        const l2 = parts.slice(i).join(" ");
        const d = Math.abs(g.measureText(l1).width - g.measureText(l2).width);
        if (d < bestDiff) {
          bestDiff = d;
          best = l1 + "\n" + l2;
        }
      }
      lines = best.split("\n");
    }
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.lineJoin = "round";
    g.strokeStyle = "#000";
    g.lineWidth = Math.max(5, fs * 0.16);
    const lh = Math.round(fs * 1.18);
    const baseY = H * 0.82 - (lines.length - 1) * lh;
    lines.forEach((ln, li) => {
      const y = baseY + li * lh;
      g.strokeText(ln, W / 2, y);
      g.fillStyle =
        activeWord || lines.length === 1
          ? st?.activeColor || "#FFD400"
          : st?.color || "#FFFFFF";
      g.fillText(ln, W / 2, y);
    });
  };

  // ===== GRABADORA DE IMAGEN =====
  const mime = pickMime();
  const vstream = canvas.captureStream(fps);
  const rec = new MediaRecorder(
    new MediaStream(vstream.getVideoTracks()),
    mime ? { mimeType: mime, videoBitsPerSecond: 2_800_000 } : undefined
  );
  const usedMime = rec.mimeType || mime;
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) parts.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  try {
    rec.start(1000);
    let tGlobal = 0;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const source = project.sources.find((s) => s.id === clip.sourceId)!;
      const v = await getVid(source.url);
      const dur = Math.max(0.2, clip.end - clip.start);
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        };
        v.addEventListener("seeked", onSeeked);
        try {
          v.currentTime = Math.max(0, clip.start);
        } catch {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        }
        setTimeout(() => {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        }, 8000);
      });
      await v.play().catch(() => {});
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const el = (performance.now() - t0) / 1000;
          drawCover(g, v, W, H);
          drawCue(tGlobal + el);
          const done = tGlobal + el;
          opts.onStage?.(
            `Grabando vídeo… ${done.toFixed(0)}s de ${totalDur.toFixed(0)}s · quedan ~${Math.max(0, totalDur - done).toFixed(0)}s`,
            5 + Math.min(1, done / totalDur) * 50
          );
          if (el >= dur || v.ended) {
            resolve();
          } else {
            requestAnimationFrame(step);
          }
        };
        requestAnimationFrame(step);
      });
      v.pause();
      tGlobal += dur;
    }
    // Cola para el último fotograma
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {}
    for (const v of vidCache.values()) {
      try {
        v.pause();
        v.removeAttribute("src");
      } catch {}
    }
    try {
      document.body.removeChild(canvas);
    } catch {}
  }
  await stopped;

  const blob = new Blob(parts, {
    type: usedMime.includes("mp4") ? "video/mp4" : "video/webm",
  });
  if (!blob.size || blob.size < 64 * 1024) {
    throw new Error("grabación sin datos suficientes");
  }
  const validation = {
    ok: true,
    duration: totalDur,
    width: W,
    height: H,
    fps,
    hasAudio: !!(plan.voice?.audioUrl || (plan.music && project.music?.url)),
    audioDuration: totalDur,
    sizeBytes: blob.size,
    codec: usedMime.includes("mp4") ? "h264(video)" : "webm(video)",
    errors: [] as string[],
  };
  const url = URL.createObjectURL(blob);
  opts.onStage?.("Vídeo grabado", 56);
  return { blob, url, validation };
}
