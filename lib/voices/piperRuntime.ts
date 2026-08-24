/**
 * RUNTIME PIPER LOCAL (100% navegador, sin claves ni proxies).
 *   · Fonemización: WebWorker oficial de piper-tts-web + espeak-ng (WASM)
 *   · Inferencia:   onnxruntime-web CPU/1 hilo, sesión por voz
 * Binarios descargados UNA vez → IndexedDB → blob URLs (offline después).
 */
import * as Ort from "onnxruntime-web";
import { cacheGet, cachePut } from "@/lib/idb";
import { fetchBinaryWithProgress, TimeoutError } from "@/lib/net";

// Assets auto-hospedados en /piper/ (mismo origen → sin CORS, funciona en iPhone).
// Se resuelven contra la RAÍZ del basePath (no contra la ruta actual de la página),
// porque en /crear document.baseURI es /videos/crear y rompería las rutas.
//
// ASSET_V: cache-busting OBLIGATORIO. iOS Safari cachea de forma agresiva los
// Web Workers y los .wasm; tras cambiar estos binarios, la caché sirve la versión
// vieja y la voz falla SILENCIOSAMENTE. El query fuerza la re-descarga siempre.
const ASSET_V = "?v=4";
function assetRoot(): string {
  if (typeof window === "undefined") return "/piper/";
  const base = window.location.pathname.startsWith("/videos") ? "/videos" : "";
  return base + "/piper/";
}
function piperAssetUrl(file: string): string {
  return assetRoot() + file + ASSET_V;
}

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
let ortWasmLoaded = false;

const PHO_WASM = piperAssetUrl("piper_phonemize.wasm");
const PHO_DATA = piperAssetUrl("piper_phonemize.data");
// ORT 1.20.x carga el PEGAMENTO ES módulo (ort-wasm-simd-threaded.mjs), no el .wasm.
// Lo servimos como .js para evitar problemas de MIME en GitHub Pages; el .wasm
// se resuelve vía locateFile con esta URL explícita.
const ORT_WASM_MJS = piperAssetUrl("ort-wasm-simd-threaded.js");
const ORT_WASM_WASM = piperAssetUrl("ort-wasm-simd-threaded.wasm");

export async function ensurePiperRuntime(
  onProgress?: ProgressFn,
  signal?: AbortSignal
): Promise<void> {
  if (!configured) {
    Ort.env.wasm.numThreads = 1;
    Ort.env.wasm.simd = true;
    Ort.env.wasm.proxy = false;
    // Objeto explícito: mjs = pegamento ES módulo, wasm = binario. Así ORT no
    // falla intentando import() un .mjs 404.
    Ort.env.wasm.wasmPaths = { mjs: ORT_WASM_MJS, wasm: ORT_WASM_WASM };
    configured = true;
  }
  // El wasm de ORT pesa ~30MB. Lo descargamos nosotros CON PROGRESO y se lo
  // pasamos a ORT vía wasmBinary, así la barra se mueve durante la descarga
  // (antes parecía congelada y el usuario creía que estaba pillado).
  if (!ortWasmLoaded) {
    const buf = await fetchBinaryWithProgress(
      ORT_WASM_WASM,
      (l, t) => onProgress?.(l, t || l),
      { signal, timeoutMs: 180000 }
    );
    Ort.env.wasm.wasmBinary = buf;
    ortWasmLoaded = true;
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
    const w = new Worker(assetRoot() + "PhonemizeWebWorker.js" + ASSET_V);
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
        w.postMessage({ type: "loadModule", data: [PHO_WASM, PHO_DATA] });
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

/** No deja congelar el hilo: reject tras `ms` si ORT no responde (iOS). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${label} (${ms}ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Sintetiza UN fragmento con Piper a partir de su registro ya descargado */
export async function synthesizeWithPiper(
  voiceId: string,
  record: PiperVoiceRecord,
  text: string,
  speed = 1,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const cfg = record.config;
  const pho = await phonemize(text, cfg);
  onProgress?.(30);
  const ids = pho.phoneme_ids;
  if (!ids || ids.length < 2) throw new Error("Fonetización vacía");
  // Seguridad anti-congelación: si ORT no instancia/ejecuta en 75s, falla
  // rápido y el pipeline degrada a solo-música en lugar de quedarse pillado.
  const session = await withTimeout(getSession(voiceId, record.onnx), 120000, "ORT session");
  onProgress?.(60);
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
  const out = await withTimeout(session.run(feeds), 120000, "ORT run");
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
