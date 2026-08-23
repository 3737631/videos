/**
 * Voz neuronal LOCAL (Kokoro-82M vía WASM/WebGPU).
 * SOLO escritorio y SOLO voces inglesas (el modelo es angloparlante).
 * Devuelve WAV crudo; la validación/duración vive en tts.ts.
 */
export type DownloadInfo = { status: string; loaded?: number; total?: number; name?: string };

const kokoroListeners = new Set<(pct: number | null) => void>();
const fileProgress = new Map<string, { loaded: number; total: number }>();

export function onKokoroDownload(cb: (pct: number | null) => void): () => void {
  kokoroListeners.add(cb);
  return () => {
    kokoroListeners.delete(cb);
  };
}

function emitKokoroProgress() {
  let loaded = 0;
  let total = 0;
  for (const f of fileProgress.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  kokoroListeners.forEach((cb) => cb(pct));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kokoroInst: any = null;

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

async function makeKokoro(dtype: string, device: string): Promise<any> {
  const mod = await import("kokoro-js");
  const progress_callback = (info: DownloadInfo) => {
    if (info.status === "progress" && info.total) {
      fileProgress.set(info.name || "model", { loaded: info.loaded || 0, total: info.total });
      emitKokoroProgress();
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (mod as any).KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype, device, progress_callback });
}

/** Comprueba que la voz realmente suena (evita rutas que devuelven audio mudo) */
async function sampleOk(tts: any): Promise<boolean> {
  try {
    const out = await tts.generate("This is a quick voice test.", { voice: "af_heart", speed: 1 });
    const n = out.audio?.length || 0;
    if (n < 1000) return false;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i += 16) {
      sum += Math.abs(out.audio[i]);
      count++;
    }
    return sum / count > 0.001;
  } catch {
    return false;
  }
}

/**
 * Carga del modelo con TOPE DURO de tiempo: la promesa siempre termina.
 * El timer se limpia SIEMPRE.
 */
async function loadWithTimeout(): Promise<any> {
  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const isMobileLike =
    typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const attempt = async (): Promise<any> => {
    if (hasWebGPU && !isMobileLike) {
      for (const dtype of ["fp16", "fp32"]) {
        try {
          fileProgress.clear();
          const cand = await makeKokoro(dtype, "webgpu");
          if (await sampleOk(cand)) return cand;
        } catch {
          /* siguiente opción */
        }
      }
    }
    fileProgress.clear();
    return await makeKokoro("q8", "wasm");
  };

  const KOKORO_LOAD_CAP_MS = 180000;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      attempt(),
      new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error("la descarga de la voz local tardó demasiado")), KOKORO_LOAD_CAP_MS);
      }),
    ]);
  } finally {
    if (timerId) clearTimeout(timerId); // LIMPIEZA GARANTIZADA
  }
}

export async function getKokoro(): Promise<any> {
  if (!kokoroInst) kokoroInst = await loadWithTimeout();
  return kokoroInst;
}

export function isKokoroReady(): boolean {
  return kokoroInst !== null;
}

export async function preloadKokoro(): Promise<void> {
  try {
    await getKokoro();
  } catch {
    /* se reintentará al generar */
  }
}

function floatToWavBlob(samples: Float32Array, sampleRate = 24000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Sintetiza UNA frase con la voz Kokoro indicada (p.ej. "af_heart").
 * onProgress aquí no aplica (una frase = una unidad); signal aborta antes.
 */
export async function synthesizeChunkLocal(
  text: string,
  kokoroVoice: string,
  signal?: AbortSignal
): Promise<Blob> {
  if (signal?.aborted) throw new DOMException("cancelado", "AbortError");
  const tts = await getKokoro();
  const out = await tts.generate(text.trim(), { voice: kokoroVoice, speed: 1.05 });
  const audio: Float32Array | undefined = out.audio;
  if (!audio || audio.length < 1000) throw new Error("audio local vacío");
  return floatToWavBlob(audio, out.sampling_rate || 24000);
}
