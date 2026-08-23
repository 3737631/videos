/**
 * DETECCIÓN DE MOMENTOS VIRALES (100% local, en el navegador).
 *
 * Idea: muestrear el vídeo a baja resolución, calcular la "energía de movimiento"
 * (diferencia de fotograma a fotograma) y seleccionar los tramos con más
 * movimiento/accion (los que mejor enganchan) hasta completar la duración deseada.
 *
 * `selectSegments` es PURO y testeable: recibe una línea temporal de scores y
 * devuelve los tramos óptimos en segundos.
 */
export interface Segment {
  start: number;
  end: number;
}

/**
 * Selecciona tramos contiguos que maximizan la energía hasta sumar ~targetSec.
 * - Ventana deslizante de `windowSec` s.
 * - Selección voraz de la ventana con mayor score, sin solapamientos.
 * - Devuelve los tramos ORDENADOS CRONOLÓGICAMENTE.
 */
export function selectSegments(
  scores: number[],
  dt: number,
  targetSec: number,
  windowSec = 4
): Segment[] {
  const total = scores.length * dt;
  if (scores.length < 2 || total <= targetSec) {
    return [{ start: 0, end: total }];
  }
  const win = Math.max(2, Math.round(windowSec / dt));
  const winScore: Array<{ i: number; s: number }> = [];
  let run = 0;
  for (let i = 0; i < scores.length; i++) {
    run += scores[i];
    if (i >= win) run -= scores[i - win];
    if (i >= win - 1) {
      winScore.push({ i: i - win + 1, s: run / win });
    }
  }
  const chosen: Segment[] = [];
  let chosenCount = 0;
  const overlaps = (i: number) =>
    chosen.some((c) => i < c.end / dt + 1 && i + win > c.start / dt - 1);
  while (chosenCount < targetSec && winScore.length) {
    let best = -1;
    let bestS = -Infinity;
    for (let k = 0; k < winScore.length; k++) {
      if (overlaps(winScore[k].i)) continue;
      if (winScore[k].s > bestS) {
        bestS = winScore[k].s;
        best = k;
      }
    }
    if (best < 0) break;
    const i = winScore[best].i;
    const seg: Segment = { start: i * dt, end: Math.min(total, (i + win) * dt) };
    chosen.push(seg);
    chosenCount += seg.end - seg.start;
    winScore.splice(best, 1);
  }
  if (chosen.length === 0) return [{ start: 0, end: total }];
  chosen.sort((a, b) => a.start - b.start);
  return chosen;
}

/** Línea de tiempo de energía muestreada desde un vídeo (navegador). */
export async function detectHighlights(
  videoBlob: Blob,
  opts: { targetSec: number; signal?: AbortSignal; maxSamples?: number }
): Promise<Segment[]> {
  const { targetSec, signal, maxSamples = 90 } = opts;
  if (typeof document === "undefined") return [{ start: 0, end: targetSec }];
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), 20000);
      video.onloadedmetadata = () => {
        clearTimeout(t);
        res();
      };
      video.onerror = () => {
        clearTimeout(t);
        rej(new Error("err"));
      };
    });
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    if (dur <= targetSec || dur < 1) return [{ start: 0, end: dur || targetSec }];

    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 64;
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (!g) return [{ start: 0, end: dur }];
    const dt = Math.max(0.2, dur / maxSamples);
    const scores: number[] = [];
    let prev: Uint8ClampedArray | null = null;
    for (let t = 0; t < dur; t += dt) {
      if (signal?.aborted) break;
      await seekTo(video, t);
      g.drawImage(video, 0, 0, cv.width, cv.height);
      const cur = g.getImageData(0, 0, cv.width, cv.height).data;
      if (prev) {
        let d = 0;
        for (let p = 0; p < cur.length; p += 4) {
          d +=
            Math.abs(cur[p] - prev[p]) +
            Math.abs(cur[p + 1] - prev[p + 1]) +
            Math.abs(cur[p + 2] - prev[p + 2]);
        }
        scores.push(d / (cur.length / 4) / 255);
      } else {
        scores.push(0);
      }
      prev = cur;
      if (scores.length >= maxSamples) break;
    }
    if (scores.length < 3) return [{ start: 0, end: dur }];
    return selectSegments(scores, dt, targetSec);
  } catch {
    return [{ start: 0, end: targetSec }];
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise<void>((res) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      res();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = Math.min(video.duration - 0.01, Math.max(0, t));
    } catch {
      video.removeEventListener("seeked", onSeeked);
      res();
    }
    setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      res();
    }, 1500);
  });
}

/** Duración objetivo del anuncio según el vídeo fuente. */
export function pickTargetDuration(sourceDuration: number, onlyMusic: boolean): number {
  if (!sourceDuration || sourceDuration < 12) return Math.max(6, sourceDuration || 12);
  const ratio = onlyMusic ? 0.7 : 0.55;
  const d = Math.round(sourceDuration * ratio);
  return Math.min(34, Math.max(12, d));
}
