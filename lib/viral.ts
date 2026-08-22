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
 * Detecta los momentos con más energía/gancho del vídeo analizando
 * la energía de audio (RMS) por ventanas de 0,5 s. Son los tramos
 * "virales": gritos, risas, música intensa, picos de acción...
 * Si no hay audio o no se puede decodificar, devuelve tramos equidistantes.
 */
export async function detectViralHighlights(
  src: SourceVideo,
  onProgress?: (stage: string, pct: number) => void
): Promise<ViralSegment[]> {
  const duration = src.duration || 0;
  if (!duration || duration < 3) {
    return [{ start: 0, end: Math.max(duration, 1), score: 1 }];
  }

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

  onProgress?.("Buscando momentos virales", 45);

  // Sin energía utilizable -> tramos equidistantes
  if (!energies || !energies.length) {
    return evenSegments(duration);
  }

  // Suavizado (media móvil de 3) para evitar picos falsos
  const smooth = energies.map((_, i) => {
    const a = energies![Math.max(0, i - 1)];
    const b = energies![i];
    const c = energies![Math.min(energies!.length - 1, i + 1)];
    return (a + b + c) / 3;
  });

  const maxE = Math.max(...smooth, 1e-6);
  const norm = smooth.map((v) => v / maxE);

  // Duración objetivo de cada corte viral y presupuesto total
  const segLen = duration <= 20 ? Math.min(duration * 0.8, 8) : 8;
  const budget = Math.max(segLen, Math.min(duration * 0.35, 30));

  const step = WINDOW_SEC;
  const candidates: { start: number; score: number }[] = [];
  for (let t = 0; t + segLen <= duration + 0.01; t += step) {
    const i0 = Math.floor(t / WINDOW_SEC);
    const i1 = Math.min(norm.length, Math.ceil((t + segLen) / WINDOW_SEC));
    let acc = 0;
    for (let i = i0; i < i1; i++) acc += norm[i];
    // Bonus si el momento empieza fuerte (hook al inicio)
    const hookBonus = norm[i0] ?? 0;
    candidates.push({ start: t, score: acc + hookBonus * 2 });
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
