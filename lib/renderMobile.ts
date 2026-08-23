import type { Project } from "@/types";
import { quickValidateMp4 } from "@/lib/render";

export interface MobileRenderOptions {
  width: number;
  height: number;
  fps?: number;
  musicVolume?: number;
  voiceVolume?: number;
  originalVolume?: number;
  onStage?: (stage: string, pct: number) => void;
}

function pickMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
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

/**
 * Render NATIVO para iPhone/iPad: reproduce los clips en un canvas y graba con
 * MediaRecorder (codificador por hardware del sistema). Duración total ≈ tiempo
 * real del vídeo (~20-30s), sin WASM pesado ni cuelgues de memoria.
 */
export async function renderProjectMobile(
  project: Project,
  opts: MobileRenderOptions
): Promise<{ blob: Blob; url: string; validation: Awaited<ReturnType<typeof quickValidateMp4>> }> {
  const plan = project.editPlan;
  if (!plan) throw new Error("No hay plan de edición");
  const W = Math.round(opts.width);
  const H = Math.round(opts.height);
  const fps = opts.fps || 30;

  const clips = plan.clips.filter((c) => project.sources.some((s) => s.id === c.sourceId));
  if (!clips.length) throw new Error("No hay clips para grabar");
  const totalDur = clips.reduce((a, c) => a + Math.max(0, c.end - c.start), 0);

  opts.onStage?.("Preparando grabación nativa", 8);

  // Lienzo de salida
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { alpha: false })!;

  // ===== AUDIO: todo con WebAudio nativo (voz + música en bucle) =====
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const actx = new AC();
  const dest = actx.createMediaStreamDestination();
  const master = actx.createGain();
  master.gain.value = 1;
  master.connect(dest);

  let voiceEl: HTMLAudioElement | null = null;
  if (plan.voice?.audioUrl) {
    voiceEl = new Audio();
    voiceEl.crossOrigin = "anonymous";
    voiceEl.src = plan.voice.audioUrl;
    await once(voiceEl, "canplaythrough");
    const src = actx.createMediaElementSource(voiceEl);
    const gv = actx.createGain();
    gv.gain.value = opts.voiceVolume ?? 1;
    src.connect(gv);
    gv.connect(master);
  }

  let musicSource: AudioBufferSourceNode | null = null;
  if (plan.music && project.music?.url) {
    const ab = await (await fetch(project.music.url)).arrayBuffer();
    const buf = await actx.decodeAudioData(ab);
    musicSource = actx.createBufferSource();
    musicSource.buffer = buf;
    musicSource.loop = true;
    const gm = actx.createGain();
    gm.gain.value = opts.musicVolume ?? 0.25;
    musicSource.connect(gm);
    gm.connect(master);
  }

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

  // Precargar el primer vídeo ANTES de empezar a grabar
  await getVid(project.sources.find((s) => s.id === clips[0].sourceId)!.url);

  const cues = plan.subtitles?.cues || [];
  const st = plan.subtitles?.style;
  const fontPx = Math.round(H * (((st?.size as number) || 7) / 100));

  const drawCue = (t: number) => {
    const cue = cues.find((q) => t >= q.start && t < q.end);
    if (!cue) return;
    const words = cue.words || [];
    const active = words.find((w) => t >= w.start && t < w.end);
    const text = cue.text.toUpperCase();
    g.font = `900 ${fontPx}px -apple-system, Impact, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    const y = H * 0.78;
    const cx = W / 2;
    g.lineJoin = "round";
    g.strokeStyle = "#000";
    g.lineWidth = Math.max(6, fontPx * 0.18);
    g.strokeText(text, cx, y);
    g.fillStyle = active ? st?.activeColor || "#FFD400" : st?.color || "#FFFFFF";
    g.fillText(text, cx, y);
  };

  // ===== GRABADORA =====
  // Safari exige que el canvas esté EN el documento para captureStream
  canvas.style.cssText =
    "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
  document.body.appendChild(canvas);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  const mime = pickMime();
  const vstream = canvas.captureStream(fps);
  const mixed = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 2_800_000 } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) parts.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  try {
    await actx.resume();
    rec.start(1000);
    if (musicSource) musicSource.start();
    if (voiceEl) void voiceEl.play().catch(() => {});

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
            12 + Math.min(1, done / totalDur) * 76
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

    // Cola mínima para que el último fotograma y el audio entren en el archivo
    await new Promise((r) => setTimeout(r, 350));
  } finally {
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {}
    if (musicSource) try { musicSource.stop(); } catch {}
    if (voiceEl) try { voiceEl.pause(); } catch {}
    try {
      actx.close();
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

  const blob = new Blob(parts, { type: mime.includes("mp4") ? "video/mp4" : "video/webm" });
  if (!blob.size) throw new Error("La grabación nativa salió vacía");
  opts.onStage?.("Comprobando calidad", 94);
  const validation = await quickValidateMp4(blob);
  if (!validation.ok) throw new Error(`Control de calidad falló: ${validation.errors.join("; ")}`);
  const url = URL.createObjectURL(blob);
  opts.onStage?.("Finalizando", 100);
  return { blob, url, validation };
}
