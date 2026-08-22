import type { SourceVideo } from "@/types";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { deleteFileSafe } from "@/lib/ffmpeg";

export interface ViralSegment {
  start: number;
  end: number;
  score: number;
}

const WINDOW_SEC = 0.5;

/**
 * Muestrea el movimiento visual del vídeo: extrae frames pequeños en escala
 * de grises cada stepSec segundos y mide la diferencia media entre frames
 * consecutivos. Devuelve una curva por punto de muestreo (o null si falla).
 */
async function sampleMotion(
  url: string,
  duration: number,
  stepSec: number,
  onProgress?: (stage: string, pct: number) => void
): Promise<{ times: number[]; diffs: number[] } | null> {
  return new Promise((resolve) => {
    const W = 32;
    const H = 18;
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.preload = "auto";
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    if (!cx) return resolve(null);

    const times: number[] = [];
    for (let t = 0.25; t < duration; t += stepSec) times.push(t);
    if (!times.length) times.push(Math.min(0.5, duration / 2));

    const diffs = new Array<number>(times.length).fill(0);
    let prevGray: Float32Array | null = null;
    let idx = 0;
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(idx > 3 ? { times, diffs } : null);
      }
    }, 25000);

    const finish = (val: { times: number[]; diffs: number[] } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(val);
    };

    v.onseeked = () => {
      try {
        cx.drawImage(v, 0, 0, W, H);
        const d = cx.getImageData(0, 0, W, H).data;
        const gray = new Float32Array(W * H);
        for (let p = 0; p < W * H; p++) {
          gray[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2];
        }
        if (prevGray) {
          let s = 0;
          for (let p = 0; p < gray.length; p++) {
            const df = gray[p] - prevGray![p];
            s += df * df;
          }
          diffs[idx] = Math.sqrt(s / gray.length);
        }
        prevGray = gray;
      } catch {
        finish(null);
        return;
      }
      idx++;
      onProgress?.(
        `Analizando movimiento ${idx}/${times.length}`,
        10 + Math.round((idx / times.length) * 30)
      );
      if (idx >= times.length) finish({ times, diffs });
      else v.currentTime = Math.min(duration - 0.05, times[idx]);
    };

    v.onerror = () => finish(null);
    try {
      v.currentTime = times[0];
    } catch {
      finish(null);
    }
  });
}

/**
 * Detecta los momentos con más gancho combinando DOS señales:
 * 1) Energía de audio (RMS): gritos, risas, música intensa...
 * 2) Movimiento visual (diferencia entre frames): acción, cambios de escena...
 * Si alguna señal falla, usa la otra sola. Si ambas fallan, tramos equidistantes.
 */
export async function detectViralHighlights(
  src: SourceVideo,
  onProgress?: (stage: string, pct: number) => void
): Promise<ViralSegment[]> {
  const duration = src.duration || 0;
  if (!duration || duration < 3) {
    return [{ start: 0, end: Math.max(duration, 1), score: 1 }];
  }

  // Señal 1: energía de audio
  let energies: number[] | null = null;
  try {
    onProgress?.("Analizando energía de audio", 5);
    const res = await fetch(src.url);
    const buf = await res.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const ch = decoded.getChannelData(0);
    const win = Math.max(1, Math.floor(decoded.sampleRate * WINDOW_SEC));
    const n = Math.floor(ch.length / win);
    energies = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const base = i * win;
      for (let j = 0; j < win; j += 4) {
        const v = ch[base + j];
        sum += v * v;
      }
      energies[i] = Math.sqrt(sum / (win / 4));
    }
    ctx.close().catch(() => {});
  } catch {
    energies = null;
  }

  // Señal 2: movimiento visual
  onProgress?.("Analizando movimiento", 12);
  const motion = await sampleMotion(src.url, duration, 0.75, onProgress);

  // Rejilla común de 0,5 s sobre la duración
  const gridN = Math.max(1, Math.ceil(duration / WINDOW_SEC));

  const buildCurve = (samples: number[] | null, sampleStepSec: number): number[] | null => {
    if (!samples || !samples.some((v) => v > 0)) return null;
    const curve = new Array<number>(gridN).fill(0);
    for (let g = 0; g < gridN; g++) {
      const tCenter = (g + 0.5) * WINDOW_SEC;
      const si = Math.min(samples.length - 1, Math.max(0, Math.round((tCenter - 0.25) / sampleStepSec)));
      curve[g] = samples[si];
    }
    const max = Math.max(...curve, 1e-6);
    return curve.map((v) => v / max);
  };

  const smoothCurve = (c: number[]): number[] =>
    c.map((_, i) => (c[Math.max(0, i - 1)] + c[i] + c[Math.min(c.length - 1, i + 1)]) / 3);

  const audioCurve = energies && energies.length ? smoothCurve(buildCurve(energies, WINDOW_SEC) || []) : null;
  const motionCurve = motion ? smoothCurve(buildCurve(motion.diffs, 0.75) || []) : null;

  onProgress?.("Buscando momentos virales", 48);

  if (!audioCurve && !motionCurve) {
    return evenSegments(duration);
  }

  // Puntuación combinada por ventana deslizante
  const segLen = duration <= 20 ? Math.min(duration * 0.8, 8) : 8;
  const budget = Math.max(segLen, Math.min(duration * 0.35, 30));

  const candidates: { start: number; score: number }[] = [];
  const wCount = Math.max(1, Math.round(segLen / WINDOW_SEC));
  for (let t = 0; t + segLen <= duration + 0.01; t += WINDOW_SEC) {
    const i0 = Math.floor(t / WINDOW_SEC);
    let accA = 0;
    let accM = 0;
    for (let w = 0; w < wCount; w++) {
      const gi = Math.min(gridN - 1, i0 + w);
      accA += audioCurve ? audioCurve[gi] : 0;
      accM += motionCurve ? motionCurve[gi] : 0;
    }
    // Normalizar por peso disponible de cada señal
    const wa = audioCurve ? 1 : 0;
    const wm = motionCurve ? 1 : 0;
    const wsum = wa + wm || 1;
    const combined = (accA + accM) / (wCount * wsum);
    // Bonus si arranca fuerte (hook al inicio del corte)
    const gi0 = Math.min(gridN - 1, i0);
    const hook =
      (audioCurve ? audioCurve[gi0] : 0) + (motionCurve ? motionCurve[gi0] : 0);
    candidates.push({ start: t, score: combined + hook * 1.5 });
  }
  if (!candidates.length) return evenSegments(duration);

  candidates.sort((a, b) => b.score - a.score);

  const picked: ViralSegment[] = [];
  let total = 0;
  for (const c of candidates) {
    if (total >= budget) break;
    const overlaps = picked.some(
      (p) => c.start < p.end + 1 && c.start + segLen > p.start - 1
    );
    if (overlaps) continue;
    picked.push({ start: c.start, end: c.start + segLen, score: c.score });
    total += segLen;
  }

  picked.sort((a, b) => a.start - b.start);
  onProgress?.("Momentos virales listos", 70);
  return picked.map((p) => ({
    start: round2(Math.max(0, p.start)),
    end: round2(Math.min(duration, p.end)),
    score: Math.round(p.score * 100) / 100,
  }));
}

function evenSegments(duration: number): ViralSegment[] {
  const segLen = Math.min(8, duration / 2);
  const count = Math.max(1, Math.min(3, Math.floor(duration / segLen)));
  const segs: ViralSegment[] = [];
  for (let i = 0; i < count; i++) {
    segs.push({
      start: round2((duration * i) / count),
      end: round2(Math.min(duration, (duration * i) / count + segLen)),
      score: 0,
    });
  }
  return segs;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Recorte SIN pérdida de calidad: copia de streams (-c copy),
 * sin re-codificar. Corta cada segmento viral y los une en un solo MP4.
 */
export async function losslessCut(
  ffmpeg: FFmpeg,
  src: SourceVideo,
  segments: ViralSegment[],
  onProgress?: (stage: string, pct: number) => void
): Promise<{ blob: Blob; url: string; duration: number }> {
  const extMatch = /\.(mp4|mov|m4v|webm)$/i.exec(src.name);
  const ext = (extMatch ? extMatch[1] : "mp4").toLowerCase();
  const inName = `viral_in.${ext}`;
  const outName = ext === "webm" ? "viral_out.webm" : "viral_out.mp4";

  onProgress?.("Cargando vídeo", 5);
  const blob = await (await fetch(src.url)).blob();
  const data = new Uint8Array(await blob.arrayBuffer());
  await ffmpeg.writeFile(inName, data);

  const partNames: string[] = [];
  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      onProgress?.(`Recortando viral ${i + 1}/${segments.length}`, 10 + Math.round((i / segments.length) * 60));
      const dur = Math.max(0.5, seg.end - seg.start);
      const partName = `viral_part_${i}.${ext === "webm" ? "webm" : "mp4"}`;
      const rc = await ffmpeg.exec([
        "-ss",
        String(seg.start),
        "-i",
        inName,
        "-t",
        String(dur),
        "-c",
        "copy", // SIN recodificar: calidad idéntica al original
        "-avoid_negative_ts",
        "make_zero",
        "-y",
        partName,
      ]);
      if (rc !== 0) throw new Error(`No se pudo recortar el segmento ${i + 1}`);
      partNames.push(partName);
    }

    if (partNames.length === 1) {
      const out = await ffmpeg.readFile(partNames[0]);
      const bytes = typeof out === "string" ? new TextEncoder().encode(out) : new Uint8Array(out);
      const outBlob = new Blob([bytes.buffer as ArrayBuffer], {
        type: ext === "webm" ? "video/webm" : "video/mp4",
      });
      return finish(outBlob);
    }

    onProgress?.("Uniendo momentos virales", 80);
    const listContent = partNames.map((p) => `file '${p}'`).join("\n");
    await ffmpeg.writeFile("viral_list.txt", new TextEncoder().encode(listContent));
    const rc = await ffmpeg.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "viral_list.txt",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      outName,
    ]);
    if (rc !== 0) throw new Error("No se pudieron unir los cortes virales");

    const out = await ffmpeg.readFile(outName);
    const bytes = typeof out === "string" ? new TextEncoder().encode(out) : new Uint8Array(out);
    const type = ext === "webm" ? "video/webm" : "video/mp4";
    const outBlob = new Blob([bytes.buffer as ArrayBuffer], { type });
    return finish(outBlob);
  } finally {
    await deleteFileSafe(ffmpeg, inName);
    await deleteFileSafe(ffmpeg, "viral_list.txt");
    await deleteFileSafe(ffmpeg, outName);
    for (const p of partNames) await deleteFileSafe(ffmpeg, p);
  }

  function finish(b: Blob): { blob: Blob; url: string; duration: number } {
    const url = URL.createObjectURL(b);
    const totalDur = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
    onProgress?.("Recorte viral listo", 100);
    return { blob: b, url, duration: totalDur };
  }
}
