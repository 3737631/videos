import type { AppSettings, VoiceOption } from "@/types";

export interface TtsResult {
  blob: Blob;
  url: string;
  duration: number;
  provider: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // Voces en INGLÉS (ideales para contenido viral en EE.UU./global)
  { id: "alloy", name: "Alloy", gender: "neutra", style: "Natural US", language: "English", accent: "US", speed: 1 },
  { id: "echo", name: "Echo", gender: "masculina", style: "Deep narrator", language: "English", accent: "US", speed: 1 },
  { id: "fable", name: "Fable", gender: "neutra", style: "Storyteller UK", language: "English", accent: "UK", speed: 1 },
  { id: "onyx", name: "Onyx", gender: "masculina", style: "Movie trailer", language: "English", accent: "US", speed: 1 },
  { id: "nova", name: "Nova", gender: "femenina", style: "Energetic creator", language: "English", accent: "US", speed: 1 },
  { id: "shimmer", name: "Shimmer", gender: "femenina", style: "Soft UGC", language: "English", accent: "US", speed: 1 },
];

export function getVoiceById(id: string): VoiceOption {
  return VOICE_CATALOG.find((v) => v.id === id) || VOICE_CATALOG[0];
}

const PREVIEW_LINES: Record<string, string> = {
  English: "Wait for it... this is the part everyone is talking about!",
};

/**
 * Previsualización GRATUITA de voz usando el sintetizador del navegador.
 * No necesita claves de API ni consume créditos.
 */
export function previewVoice(voice: VoiceOption): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(PREVIEW_LINES[voice.language] ?? "Hola, esta es una muestra de voz.");
  utter.lang = voice.language === "English" ? (voice.accent === "UK" ? "en-GB" : "en-US") : "es-ES";
  utter.rate = voice.speed > 0 ? Math.min(2, voice.speed) : 1;
  utter.pitch = voice.gender === "femenina" ? 1.15 : voice.gender === "masculina" ? 0.85 : 1;
  // Intentar elegir una voz del sistema que encaje con el idioma/acento
  const voices = synth.getVoices();
  const targetLang = utter.lang.toLowerCase();
  if (voice.language === "English") {
    const en = voices.find((v) => v.lang.toLowerCase() === targetLang) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)));
    if (en) utter.voice = en;
  } else {
    const es = voices.find((v) => v.lang.toLowerCase().startsWith("es"));
    if (es) utter.voice = es;
  }
  synth.speak(utter);
  return true;
}

export function stopPreview() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Genera la locución con la voz neuronal LOCAL (Kokoro, corre en el navegador):
 * ilimitada, rápida y sin claves ni cuotas. Si el dispositivo no soporta WASM,
 * usa la voz gratuita de Google como último recurso.
 */
export async function generateSpeech(
  settings: AppSettings,
  text: string,
  voiceId: string,
  options?: { speed?: number; onProgress?: (done: number, total: number) => void }
): Promise<TtsResult> {
  void settings;
  if (!text.trim()) throw new Error("El texto de la voz está vacío");
  try {
    return await generateKokoroTts(text, voiceId, options?.onProgress);
  } catch {
    return await generateGoogleTts(text);
  }
}

// ===== Voz neuronal LOCAL (Kokoro-82M vía WASM): ilimitada, sin claves =====
const KOKORO_VOICE_MAP: Record<string, string> = {
  alloy: "af_heart", // femenina cálida US
  nova: "af_bella", // femenina enérgica US
  shimmer: "af_nicole", // femenina suave US
  echo: "am_adam", // masculina profunda US
  onyx: "am_michael", // masculina narrador US
  fable: "bm_george", // masculina storyteller UK
};

interface KokoroAudio {
  toWav: () => ArrayBuffer;
  audio: Float32Array;
  sampling_rate?: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kokoroInst: any = null;

// Progreso de descarga del modelo (para mostrarlo en la UI desde el primer momento)
type DownloadInfo = { status: string; loaded?: number; total?: number; name?: string };
const kokoroListeners = new Set<(pct: number | null) => void>();
const fileProgress = new Map<string, { loaded: number; total: number }>();

export function onKokoroDownload(cb: (pct: number | null) => void): () => void {
  kokoroListeners.add(cb);
  return () => kokoroListeners.delete(cb);
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

async function getKokoro() {
  if (!kokoroInst) {
    const mod = await import("kokoro-js");
    const progress_callback = (info: DownloadInfo) => {
      if (info.status === "progress" && info.total) {
        fileProgress.set(info.name || "model", { loaded: info.loaded || 0, total: info.total });
        emitKokoroProgress();
      }
    };
    // Ruta WASM probada y fiable en todos los dispositivos (la ruta WebGPU producía
    // audio mudo en algunos navegadores de escritorio)
    kokoroInst = await mod.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "wasm",
      progress_callback,
    });
  }
  return kokoroInst;
}

export async function isKokoroReady(): Promise<boolean> {
  return kokoroInst !== null;
}

/** Descarga el modelo en segundo plano (se llama al subir vídeos para que no espere después) */
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

async function generateKokoroTts(
  text: string,
  voiceId: string,
  onProgress?: (done: number, total: number) => void
): Promise<TtsResult> {
  const tts = await getKokoro();
  const voice = KOKORO_VOICE_MAP[voiceId] || KOKORO_VOICE_MAP.alloy;
  // Trozos pequeños → progreso visible con frecuencia en todos los dispositivos
  const chunks = splitForTts(text, 130);
  const pieces: Float32Array[] = [];
  let totalLen = 0;
  let sampleRate = 24000;
  for (let i = 0; i < chunks.length; i++) {
    const out = await tts.generate(chunks[i].trim(), { voice, speed: 1.05 });
    sampleRate = out.sampling_rate || 24000;
    pieces.push(out.audio);
    totalLen += out.audio.length;
    onProgress?.(i + 1, chunks.length);
  }
  const merged = new Float32Array(totalLen);
  let off = 0;
  for (const p of pieces) {
    merged.set(p, off);
    off += p.length;
  }
  const blob = floatToWavBlob(merged, sampleRate);
  return finalizeTts(blob, "kokoro-local");
}

// ===== Último recurso: voz de Google Translate vía proxies con CORS abierto =====
function splitForTts(text: string, maxLen: number): string[] {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length <= maxLen) {
      cur = (cur + " " + s).trim();
    } else {
      if (cur) chunks.push(cur);
      cur = s.length > maxLen ? s.slice(0, maxLen) : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

const GTX_PROXIES: Array<(u: string) => string> = [
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

async function fetchWithTimeout(url: string, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function generateGoogleTts(text: string): Promise<TtsResult> {
  const chunks = splitForTts(text, 190);
  const parts: Blob[] = [];
  for (const chunk of chunks) {
    const target =
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=en&q=${encodeURIComponent(chunk)}`;
    let got: Blob | null = null;
    for (const wrap of GTX_PROXIES) {
      try {
        const res = await fetchWithTimeout(wrap(target), 12000);
        if (!res.ok) continue;
        const b = await res.blob();
        if (b.size > 1024 && (b.type.includes("audio") || b.type === "" || b.type.includes("mpeg"))) {
          got = b;
          break;
        }
      } catch {
        /* siguiente proxy */
      }
    }
    if (!got) throw new Error("Respaldo TTS no disponible");
    parts.push(got);
    if (chunks.length > 1) await new Promise((r) => setTimeout(r, 300));
  }
  const blob = new Blob(parts, { type: "audio/mpeg" });
  return finalizeTts(blob, "respaldo-gratis");
}

// ===== Utilidades =====
async function finalizeTts(blob: Blob, provider: string): Promise<TtsResult> {
  if (!blob.size || blob.size < 1024) {
    throw new Error("El proveedor TTS devolvió un archivo vacío o inválido. Reintenta.");
  }
  const url = URL.createObjectURL(blob);
  const duration = await probeAudioDuration(url);
  if (duration < 0.5) {
    URL.revokeObjectURL(url);
    throw new Error("El audio generado es demasiado corto o no contiene voz válida.");
  }
  return { blob, url, duration, provider };
}

async function probeAudioDuration(url: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration || 0);
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

export async function validateVoiceAudio(url: string): Promise<{ ok: boolean; rms: number; duration: number }> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i += 200) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / Math.ceil(data.length / 200));
    ctx.close().catch(() => {});
    return { ok: rms > 0.002, rms, duration: buf.duration };
  } catch {
    return { ok: false, rms: 0, duration: 0 };
  }
}
