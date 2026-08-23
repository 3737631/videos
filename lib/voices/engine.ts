/**
 * MOTOR DE VOZ V3 — CATÁLOGO → CACHE(IDB) → MODELO → AUDIO.
 * · Descarga UNA vez por voz (progreso real en bytes).
 * · Cache de audio generado (hash texto+voz+velocidad) → instantáneo tras la 1ª vez.
 * · Reintentos y fallback inteligente a OTRA voz del MISMO idioma ya instalada.
 */
import { cacheDel, cacheGet, cachePut, hashKey } from "@/lib/idb";
import { fetchBinaryWithProgress, fetchJsonWithTimeout } from "@/lib/net";
import { getVoiceById, sameLanguageAlternates, VOICE_CATALOG, type CatalogVoice } from "./catalog";
import {
  ensurePiperRuntime,
  synthesizeWithPiper,
  type PiperVoiceRecord,
} from "./piperRuntime";
import { preloadKokoro, synthesizeChunkLocal } from "@/lib/audio/kokoro";

export interface SynthResult {
  blob: Blob;
  duration: number;
  cached: boolean;
}

export interface SynthOptions {
  signal?: AbortSignal;
  /** pct 0..100 de la fase de voz (descarga o síntesis por frases) */
  onProgress?: (pct: number | null) => void;
  speed?: number;
}

const KOKORO_FLAG = "cc-v3-kokoro-ok";

// ── Estado de instalación ───────────────────────────────────────────────

export async function isVoiceInstalled(id: string): Promise<boolean> {
  const v = getVoiceById(id);
  if (!v) return false;
  if (v.runtime === "kokoro") {
    try {
      return localStorage.getItem(KOKORO_FLAG) === "1";
    } catch {
      return false;
    }
  }
  const rec = await cacheGet<PiperVoiceRecord>("voices", id);
  return !!rec?.onnx && rec.onnx.byteLength > 0;
}

export async function listInstalled(): Promise<string[]> {
  const out: string[] = [];
  for (const v of VOICE_CATALOG) {
    if (await isVoiceInstalled(v.id)) out.push(v.id);
  }
  return out;
}

// ── Descarga de voces (una sola vez, progreso real) ─────────────────────

async function downloadPiperVoice(
  voice: CatalogVoice,
  report: ((loaded: number, total: number) => void) | undefined,
  signal?: AbortSignal
): Promise<void> {
  const existing = await cacheGet<PiperVoiceRecord>("voices", voice.id);
  if (existing?.onnx && existing.onnx.byteLength > 0) return;
  const config = await fetchJsonWithTimeout<PiperVoiceRecord["config"]>(voice.configUrl!, {
    timeoutMs: 30000,
    signal,
  });
  const onnx = await fetchBinaryWithProgress(
    voice.modelUrl!,
    (l, t) => report?.(l, t || voice.sizeBytes),
    { signal, timeoutMs: 600000 }
  );
  if (onnx.byteLength < 1024) throw new Error("Descarga incompleta");
  await cachePut("voices", voice.id, { config, onnx, size: onnx.byteLength, savedAt: Date.now() });
}

/** Garantiza que una voz esté lista; pct real durante la descarga */
export async function ensureVoiceInstalled(
  voiceId: string,
  opts: { onProgress?: (pct: number | null) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const voice = getVoiceById(voiceId);
  if (!voice) throw new Error("Voz desconocida");
  const rep = opts.onProgress;
  if (voice.runtime === "kokoro") {
    if (await isVoiceInstalled(voiceId)) return;
    rep?.(null); // indeterminado: el progreso real lo emite kokoro
    const { onKokoroDownload } = await import("@/lib/audio/kokoro");
    const off = onKokoroDownload((pct) => rep?.(pct));
    try {
      await preloadKokoro();
      try {
        localStorage.setItem(KOKORO_FLAG, "1");
      } catch {}
      rep?.(100);
    } finally {
      off();
    }
    return;
  }
  await downloadPiperVoice(
    voice,
    (l, t) => t > 0 && rep?.(Math.min(100, Math.round((l / t) * 100))),
    opts.signal
  );
}

// ── Síntesis con cache y reintentos ─────────────────────────────────────

/** Divide en frases de tamaño sintetizable sin cortar palabras */
export function splitSentences(text: string, maxLen = 180): string[] {
  const raw = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    if (s.length <= maxLen) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const w of s.split(" ")) {
      if ((cur + " " + w).trim().length > maxLen) {
        if (cur) out.push(cur.trim());
        cur = w;
      } else cur += " " + w;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.length ? out : [text.trim()].filter(Boolean);
}

async function synthChunk(voice: CatalogVoice, text: string, speed: number, signal?: AbortSignal): Promise<Blob> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("cancelado", "AbortError");
    try {
      if (voice.runtime === "kokoro") return await synthesizeChunkLocal(text, voice.id, signal);
      const rec = await cacheGet<PiperVoiceRecord>("voices", voice.id);
      if (!rec?.onnx) throw new Error("La voz no está descargada");
      await ensurePiperRuntime(() => {}, signal);
      return await synthesizeWithPiper(voice.id, rec, text, speed);
    } catch (err) {
      lastErr = err;
      if (signal?.aborted || err instanceof DOMException) throw err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Fallo de síntesis");
}

/** Concatena varios WAV en uno solo (24 kHz mono) vía OfflineAudioContext */
async function concatWavs(chunks: Blob[], signal?: AbortSignal): Promise<Blob> {
  const RATE = 24000;
  const buffers: AudioBuffer[] = [];
  let total = 0;
  const ctx = new OfflineAudioContext(1, RATE, RATE);
  for (const c of chunks) {
    const ab = await c.arrayBuffer();
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    buffers.push(decoded);
    total += decoded.length;
    if (signal?.aborted) throw new DOMException("cancelado", "AbortError");
  }
  if (total < 1000) throw new Error("Audio vacío");
  const merged = ctx.createBuffer(1, Math.ceil(total * (RATE / (buffers[0].sampleRate || RATE))) + RATE * 0, RATE);
  // Resample manual por buffer a RATE
  let off = 0;
  for (const b of buffers) {
    const ratio = b.sampleRate / RATE;
    const n = Math.ceil(b.length / ratio);
    for (let i = 0; i < n; i++) {
      const src = b.getChannelData(0);
      const pos = Math.floor(i * ratio);
      merged.getChannelData(0)[off + i] = src[Math.min(pos, src.length - 1)] || 0;
    }
    off += n;
  }
  const wav = encodeWavBlob(merged.getChannelData(0), RATE);
  return wav;
}

function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
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
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/**
 * Sintetiza texto completo con una voz: cache → frases → concat.
 * onProgress: pct 0..100 (frases completadas; null si aún no hay base).
 */
export async function synthesize(
  text: string,
  voiceId: string,
  opts: SynthOptions = {}
): Promise<SynthResult> {
  const voice = getVoiceById(voiceId);
  if (!voice) throw new Error("Voz desconocida");
  const clean = text.trim();
  if (!clean) throw new Error("Guion vacío");
  const speed = opts.speed ?? 1;
  const key = hashKey(`v3|${voiceId}|${speed}|${clean}`);

  const hit = await cacheGet<{ blob: Blob; duration: number }>("audioCache", key);
  if (hit?.blob) return { blob: hit.blob, duration: hit.duration, cached: true };

  const chunks = splitSentences(clean);
  const blobs: Blob[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
    const b = await synthChunk(voice, chunks[i], speed, opts.signal);
    blobs.push(b);
    opts.onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
  }

  const merged = chunks.length === 1 ? blobs[0] : await concatWavs(blobs, opts.signal);
  const duration = await blobDuration(merged);
  await cachePut("audioCache", key, { blob: merged, duration });
  return { blob: merged, duration, cached: false };
}

/** Duración real decodificando el audio (fallback: estimación por bytes WAV) */
export async function blobDuration(blob: Blob): Promise<number> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
  } catch {
    // WAV PCM16: bytes/2 muestras a sampleRate de cabecera
    const ab = await blob.slice(0, 44).arrayBuffer();
    const v = new DataView(ab);
    if (v.getUint32(0, true) === 0x46464952) {
      const rate = v.getUint32(24, true) || 24000;
      return Math.max(0.3, (blob.size - 44) / 2 / rate);
    }
    throw new Error("No se pudo leer la duración del audio");
  }
}

export interface FallbackResult extends SynthResult {
  voiceId: string;
  usedFallback: boolean;
}

/** Fallback inteligente: reintenta y cambia a OTRA voz del mismo idioma YA instalada */
export async function synthesizeWithFallback(
  text: string,
  preferredId: string,
  opts: SynthOptions = {}
): Promise<FallbackResult> {
  const candidates = [preferredId, ...sameLanguageAlternates(preferredId).map((v) => v.id)];
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i];
    const alt = getVoiceById(id)!;
    if (i > 0 && !(await isVoiceInstalled(id))) continue; // solo alternativas ya instaladas
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      try {
        const res = await synthesize(text, id, {
          ...opts,
          onProgress:
            i === 0
              ? opts.onProgress
              : (p) => opts.onProgress?.(p), // misma barra, voz alternativa
        });
        return { ...res, voiceId: id, usedFallback: i > 0 };
      } catch (err) {
        lastErr = err;
        if (opts.signal?.aborted || err instanceof DOMException) throw err;
      }
    }
    void lastErr;
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("No se pudo generar la voz. Prueba otra voz o revisa tu conexión.");
}

/** Borra una voz del dispositivo */
export async function deleteVoice(voiceId: string): Promise<void> {
  const v = getVoiceById(voiceId);
  if (v?.runtime === "kokoro") {
    try {
      localStorage.removeItem(KOKORO_FLAG);
      if (typeof caches !== "undefined") await caches.delete("transformers-cache");
    } catch {}
    return;
  }
  await cacheDel("voices", voiceId);
}

// ── Síntesis con ENTONACIÓN por segmentos (timestamps REALES) ───────────

export interface ProsodyTiming {
  text: string;
  start: number;
  end: number;
}

export interface ProsodyResult {
  blob: Blob;
  duration: number;
  timings: ProsodyTiming[];
}

/** Puro: acumula duraciones+pausas en una línea de tiempo real */
export function computeProsodyTimings(
  items: Array<{ text: string; duration: number }>,
  pausesMs: number[]
): ProsodyTiming[] {
  let t = 0;
  return items.map((it, i) => {
    const start = t;
    t += it.duration + Math.max(0, pausesMs[i] ?? 0) / 1000;
    return { text: it.text, start, end: start + it.duration };
  });
}

function silenceWav(sec: number): Blob {
  const rate = 24000;
  const n = Math.max(1, Math.round(rate * sec));
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, n * 2, true);
  return new Blob([view.buffer], { type: "audio/wav" });
}

export interface ProsodyOptions {
  signal?: AbortSignal;
  onProgress?: (pct: number | null) => void;
  speed?: number;
  /** Estilo de entonación (params reales: velocidad por rol + pausas) */
  styleId?: string;
}

/**
 * Sintetiza frase a frase con velocidad/pausa según estilo y rol.
 * Devuelve timestamps REALES medidos del audio generado.
 */
export async function synthesizeProsody(
  text: string,
  voiceId: string,
  opts: ProsodyOptions = {}
): Promise<ProsodyResult> {
  const voice = getVoiceById(voiceId);
  if (!voice) throw new Error("Voz desconocida");
  const clean = text.trim();
  if (!clean) throw new Error("Guion vacío");

  const { segmentRoles, getStyle, roleSpeedOf } = await import("@/lib/script/styles");
  const style = getStyle(opts.styleId);
  const baseSpeed = opts.speed ?? 1;
  const segs = segmentRoles(clean);

  const blobs: Blob[] = [];
  const durations: number[] = [];
  const pauses: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
    const s = segs[i];
    const eff = Math.min(1.5, Math.max(0.7, baseSpeed * roleSpeedOf(style, s.role)));
    // Reutiliza cache por frase+velocidad
    const r = await synthesize(s.text, voiceId, {
      speed: eff,
      signal: opts.signal,
    });
    blobs.push(r.blob);
    durations.push(r.duration);
    pauses.push(i === segs.length - 1 ? 0 : style.pauseMs);
    opts.onProgress?.(Math.round(((i + 1) / segs.length) * 100));
  }

  // Inserta silencios entre frases
  const parts: Blob[] = [];
  blobs.forEach((b, i) => {
    parts.push(b);
    if (pauses[i] > 60) parts.push(silenceWav(pauses[i] / 1000));
  });
  const merged = parts.length === 1 ? parts[0] : await concatWavs(parts, opts.signal);
  const duration = await blobDuration(merged);
  const timings = computeProsodyTimings(
    segs.map((s, i) => ({ text: s.text, duration: durations[i] })),
    pauses
  );
  return { blob: merged, duration, timings };
}

/** Igual que synthesizeProsody pero con fallback a otra voz instalada */
export async function synthesizeProsodyWithFallback(
  text: string,
  preferredId: string,
  opts: ProsodyOptions = {}
): Promise<ProsodyResult & { voiceId: string; usedFallback: boolean }> {
  const candidates = [preferredId, ...sameLanguageAlternates(preferredId).map((v) => v.id)];
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i];
    if (!getVoiceById(id)) continue;
    if (i > 0 && !(await isVoiceInstalled(id))) continue;
    try {
      const res = await synthesizeProsody(text, id, opts);
      return { ...res, voiceId: id, usedFallback: i > 0 };
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted || err instanceof DOMException) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("No se pudo generar la voz.");
}
