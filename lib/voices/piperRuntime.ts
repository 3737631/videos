/**
 * RUNTIME PIPER LOCAL (100% navegador, sin claves ni proxies).
 *   · Fonemización: WebWorker oficial de piper-tts-web + espeak-ng (WASM)
 *   · Inferencia:   onnxruntime-web CPU/1 hilo, sesión por voz
 * Binarios descargados UNA vez → IndexedDB → blob URLs (offline después).
 */
import * as Ort from "onnxruntime-web";
import { cacheGet, cachePut } from "@/lib/idb";
import { fetchBinaryWithProgress, TimeoutError } from "@/lib/net";

const CDN_ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.wasm";
const CDN_PHO_WASM = "https://cdn.jsdelivr.net/npm/piper-tts-web@1.1.2/dist/piper/piper_phonemize.wasm";
const CDN_PHO_DATA = "https://cdn.jsdelivr.net/npm/piper-tts-web@1.1.2/dist/piper/piper_phonemize.data";

export type ProgressFn = (loaded: number, total: number) => void;

export interface PiperVoiceRecord {
  config: {
    audio: { sample_rate: number };
    inference: { noise_scale: number; length_scale: number; noise_w: number };
    num_speakers: number;
    speaker_id_map: Record<string, number>;
    espeak: { voice: string };
    phoneme_id_map: Record<string, number[]>;
  };
  onnx: ArrayBuffer;
}

const blobs = new Map<string, string>(); // cacheKey → blobURL
const sessions = new Map<string, Promise<Ort.InferenceSession>>();
let configured = false;

/**
 * Garantiza los 3 binarios del runtime (~30 MB la primera vez).
 * onProgress recibe progreso AGREGADO en bytes sobre un total fijo.
 */
const RUNTIME_TOTAL_BYTES = 11_133_407 + 629_166 + 18_077_249;

export async function ensurePiperRuntime(
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<void> {
  let done = 0;
  const track = async (key: string, url: string, size: number): Promise<string> => {
    let buf = await cacheGet<ArrayBuffer>("models", key);
    if (!buf) {
      buf = await fetchBinaryWithProgress(url, (l) => onProgress(done + Math.min(l, size), RUNTIME_TOTAL_BYTES), { signal });
      await cachePut("models", key, buf);
    }
    done += size;
    onProgress(Math.min(done, RUNTIME_TOTAL_BYTES), RUNTIME_TOTAL_BYTES);
    return URL.createObjectURL(new Blob([buf]));
  };

  const ortUrl = await track("ort-wasm", CDN_ORT, 11_133_407);
  const phoW = await track("pho-wasm", CDN_PHO_WASM, 629_166);
  const phoD = await track("pho-data", CDN_PHO_DATA, 18_077_249);
  blobs.set("ort-wasm", ortUrl);
  blobs.set("pho-wasm", phoW);
  blobs.set("pho-data", phoD);

  if (!configured) {
    Ort.env.wasm.numThreads = 1;
    Ort.env.wasm.simd = true;
    Ort.env.wasm.proxy = false;
    Ort.env.wasm.wasmPaths = { wasm: ortUrl };
    configured = true;
  }
}

// ── Fonemizador: WebWorker oficial, llamadas serializadas ───────────────
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
let phoWorker: Worker | null = null;
let phoReady: Promise<Worker> | null = null;
const phoQueue: Pending[] = [];

function nextPho<T>(msg: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    phoQueue.push({ resolve: resolve as (v: unknown) => void, reject });
    phoWorker!.postMessage(msg);
  });
}

async function getPhonemizer(): Promise<Worker> {
  if (phoReady) return phoReady;
  phoReady = (async () => {
    const wasmUrl = blobs.get("pho-wasm");
    const dataUrl = blobs.get("pho-data");
    if (!wasmUrl || !dataUrl) throw new Error("Runtime de voz no inicializado");
    const w = new Worker(new URL("piper/PhonemizeWebWorker.js", document.baseURI));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(60000)), 60000);
        w.onmessage = () => {
          clearTimeout(timer);
          resolve();
        };
        w.onerror = (e) => {
          clearTimeout(timer);
          reject(new Error(e.message || "No se pudo iniciar el fonetizador"));
        };
        w.postMessage({ type: "loadModule", data: [wasmUrl, dataUrl] });
      });
    } catch (err) {
      w.terminate();
      phoReady = null;
      throw err;
    }
    w.onmessage = ({ data }: MessageEvent) => {
      const p = phoQueue.shift();
      if (!p) return;
      p.resolve(data);
    };
    w.onerror = () => {
      const p = phoQueue.shift();
      p?.reject(new Error("Error en el fonetizador"));
    };
    phoWorker = w;
    return w;
  })();
  return phoReady;
}

async function phonemize(text: string, config: PiperVoiceRecord["config"]) {
  await getPhonemizer();
  return await nextPho<{ phoneme_ids: number[] }>({ type: "phonemize", data: [text, [config]] });
}

// ── Inferencia ONNX con sesión por voz ──────────────────────────────────
async function getSession(voiceId: string, onnx: ArrayBuffer): Promise<Ort.InferenceSession> {
  let s = sessions.get(voiceId);
  if (!s) {
    s = Ort.InferenceSession.create(new Uint8Array(onnx), { executionProviders: ["wasm"] });
    sessions.set(voiceId, s);
  }
  return s;
}

function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
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
  view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++, off += 2) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** Sintetiza UN fragmento con Piper a partir de su registro ya descargado */
export async function synthesizeWithPiper(
  voiceId: string,
  record: PiperVoiceRecord,
  text: string,
  speed = 1
): Promise<Blob> {
  const cfg = record.config;
  const pho = await phonemize(text, cfg);
  const ids = pho.phoneme_ids;
  if (!ids || ids.length < 2) throw new Error("Fonetización vacía");
  const session = await getSession(voiceId, record.onnx);
  const i64 = new BigInt64Array(ids.map((n) => BigInt(n)));
  const feeds: Record<string, Ort.Tensor> = {
    input: new Ort.Tensor("int64", i64, [1, ids.length]),
    input_lengths: new Ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)])),
    scales: new Ort.Tensor("float32", Float32Array.from([
      cfg.inference.noise_scale,
      cfg.inference.length_scale / Math.max(0.5, speed),
      cfg.inference.noise_w,
    ])),
  };
  if (cfg.num_speakers > 1 && Object.keys(cfg.speaker_id_map).length > 0) {
    feeds.sid = new Ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  }
  const out = await session.run(feeds);
  const pcm = out.output.data as Float32Array;
  if (!pcm || pcm.length < 500) throw new Error("Audio local vacío");
  return encodeWav(pcm, cfg.audio.sample_rate || 22050);
}

/** Libera memoria: sesiones ONNX, worker y blob URLs */
export function disposePiperRuntime(): void {
  sessions.clear();
  phoWorker?.terminate();
  phoWorker = null;
  phoReady = null;
  phoQueue.length = 0;
  for (const u of blobs.values()) URL.revokeObjectURL(u);
  blobs.clear();
  configured = false;
}
