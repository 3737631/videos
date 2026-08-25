/**
 * Validación de audio ANTES de exportar: nada NaN/Infinity, duración y
 * sampleRate válidos, RMS>0. Funciona en navegador (decodeAudioData) y los
 * cálculos puros también son testeables en Node.
 */

export interface AudioStats {
  duration: number;
  sampleRate: number;
  rms: number;
  peak: number;
  hasNaN: boolean;
  hasInf: number; // número de muestras no finitas
  valid: boolean;
}

/** Cálculo puro sobre un buffer mínimo (testeable sin WebAudio) */
export function computeAudioStats(buf: {
  length: number;
  sampleRate: number;
  getChannelData(ch: number): Float32Array;
}): AudioStats {
  const ch0 = buf.getChannelData(0);
  let sum = 0;
  let peak = 0;
  let nan = 0;
  let inf = 0;
  const stride = Math.max(1, Math.floor(ch0.length / 200000));
  let n = 0;
  for (let i = 0; i < ch0.length; i += stride) {
    const v = ch0[i];
    if (Number.isNaN(v)) nan++;
    else if (!Number.isFinite(v)) inf++;
    else {
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    n++;
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  const duration = buf.sampleRate > 0 ? buf.length / buf.sampleRate : 0;
  const valid =
    !nan &&
    inf === 0 &&
    buf.length > 0 &&
    buf.sampleRate > 8000 &&
    isFinite(duration) &&
    duration > 0.3 &&
    rms > 1e-4;
  return { duration, sampleRate: buf.sampleRate, rms, peak, hasNaN: nan > 0, hasInf: inf, valid };
}

function getAnyCtx(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    return new (w.AudioContext || w.webkitAudioContext)!();
  } catch {
    return null;
  }
}

async function statsFromBlob(blob: Blob): Promise<AudioStats> {
  const ctx = getAnyCtx();
  if (!ctx) throw new Error("WebAudio no disponible en este dispositivo");
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return computeAudioStats({
      length: buf.length,
      sampleRate: buf.sampleRate,
      getChannelData: (c: number) => buf.getChannelData(c),
    });
  } finally {
    ctx.close().catch(() => {});
  }
}

export async function assertVoiceAudio(blob: Blob): Promise<AudioStats> {
  const st = await statsFromBlob(blob);
  if (!st.valid || st.rms < 5e-4) {
    throw new Error(
      `Voz inválida (dur=${st.duration.toFixed(2)}s rms=${st.rms.toFixed(5)})`
    );
  }
  return st;
}

export async function assertMusicAudio(blob: Blob): Promise<AudioStats> {
  const st = await statsFromBlob(blob);
  if (!st.valid) {
    throw new Error(
      `Música inválida (dur=${st.duration.toFixed(2)}s rms=${st.rms.toFixed(5)})`
    );
  }
  return st;
}

export async function assertFinalAudio(blob: Blob): Promise<AudioStats> {
  const st = await statsFromBlob(blob);
  return st;
}
