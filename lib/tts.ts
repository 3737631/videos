/**
 * TTS — arquitectura limpia:
 *   1. Servidor de voz propio (worker; claves solo en el servidor)  ← principal
 *   2. Clave ElevenLabs PROPIA del usuario (localStorage, opcional)
 *   3. Kokoro local (SOLO escritorio, SOLO voces inglesas)
 *
 * NUNCA: proxies CORS públicos, endpoints no oficiales, ni Kokoro en móvil.
 * Cada intento usa timeouts con limpieza garantizada y acepta AbortSignal.
 * onProgress reporta frases REALES completadas (done/total), nunca inventos.
 */
import type { AppSettings, VoiceOption } from "@/types";
import { VOICES, getVoiceDef, sttLanguageFromLocale, type VoiceDef } from "@/lib/audio/voices";
import { hasBackend, ttsViaBackend, fetchWithTimeout } from "@/lib/apiClient";
import { synthesizeChunkLocal, onKokoroDownload, isKokoroReady, preloadKokoro } from "@/lib/audio/kokoro";

export interface TtsResult {
  blob: Blob;
  url: string;
  duration: number;
  provider: string;
}

export interface GenerateSpeechOptions {
  speed?: number;
  /** Cancelación real */
  signal?: AbortSignal;
  /** Frases reales completadas / total */
  onProgress?: (done: number, total: number) => void;
}

export { onKokoroDownload, isKokoroReady, preloadKokoro };

// ===== Catálogo público (metadatos, cero descargas) =====
export const VOICE_CATALOG: VoiceOption[] = VOICES.map((v) => ({
  id: v.id,
  name: v.name,
  gender: v.gender,
  style: v.gender === "femenina" ? "Femenina" : "Masculina",
  language: v.language,
  accent: v.accent,
  locale: v.locale,
  speed: 1,
}));

export function getVoiceById(id: string): VoiceOption {
  return VOICE_CATALOG.find((v) => v.id === id) || VOICE_CATALOG[0];
}

export const VOICE_LANGUAGES = Array.from(new Set(VOICES.map((v) => v.language)));

/** Muestra nativa por locale para vistas previas */
const SAMPLE_LINES: Record<string, string> = {
  "en-US": "This is a quick sample of your selected voice.",
  "en-GB": "This is a quick sample of your selected voice.",
  "es-ES": "Esta es una muestra rápida de la voz seleccionada.",
  "es-MX": "Esta es una muestra rápida de la voz seleccionada.",
  "fr-FR": "Voici un rapide échantillon de la voix sélectionnée.",
  "de-DE": "Dies ist eine kurze Probe der ausgewählten Stimme.",
  "it-IT": "Questo è un breve campion della voce selezionata.",
  "pt-BR": "Esta é uma amostra rápida da voz selecionada.",
};

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

// ===== Proveedores por frase =====
async function synthViaBackend(
  voice: VoiceDef,
  chunk: string,
  signal?: AbortSignal
): Promise<{ blob: Blob; provider: string }> {
  const blob = await ttsViaBackend(chunk, voice.providerVoiceId, voice.locale, signal);
  return { blob, provider: "servidor-de-voz" };
}

async function synthViaOwnKey(
  apiKey: string,
  voice: VoiceDef,
  chunk: string,
  signal?: AbortSignal
): Promise<{ blob: Blob; provider: string }> {
  const res = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.providerVoiceId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: chunk,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
      signal,
    },
    45000
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: { message?: string } | string };
      if (typeof j?.detail === "string") msg = j.detail;
      else if (j?.detail?.message) msg = j.detail.message;
    } catch {}
    throw new Error(`clave propia (${msg})`);
  }
  const blob = await res.blob();
  if (blob.size < 800) throw new Error("clave propia (audio vacío)");
  return { blob, provider: "elevenlabs-clave-propia" };
}

// ===== Caché local =====
const VOICE_CACHE_DB = "clipcraft-voice-cache";
let voiceCacheDb: IDBDatabase | null = null;

async function openVoiceCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (voiceCacheDb) return voiceCacheDb;
  try {
    voiceCacheDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(VOICE_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("voices")) {
          req.result.createObjectStore("voices");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return voiceCacheDb;
  } catch {
    return null;
  }
}

async function hashText(s: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `h${h}`;
  }
}

async function getCachedVoice(key: string): Promise<Blob | null> {
  try {
    const db = await openVoiceCache();
    if (!db) return null;
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction("voices", "readonly");
      const rq = tx.objectStore("voices").get(key);
      rq.onsuccess = () => resolve((rq.result as Blob) || null);
      rq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function putCachedVoice(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openVoiceCache();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction("voices", "readwrite");
      tx.objectStore("voices").put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

// ===== Utilidades =====
async function probeAudioDuration(url: string, timeoutMs = 5000): Promise<number> {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const timer = setTimeout(() => finish(0), timeoutMs); // SIEMPRE limpiado
    function finish(v: number) {
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      resolve(v);
    }
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? audio.duration || 0 : 0);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

async function finalizeTts(blob: Blob, provider: string): Promise<TtsResult> {
  if (!blob.size || blob.size < 1024) {
    throw new Error("El proveedor TTS devolvió un archivo vacío o inválido.");
  }
  const url = URL.createObjectURL(blob);
  const duration = await probeAudioDuration(url);
  if (duration < 0.5) {
    URL.revokeObjectURL(url);
    throw new Error("El audio generado es demasiado corto o no contiene voz válida.");
  }
  return { blob, url, duration, provider };
}

function isMobileDevice(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ===== Generación principal =====
export async function generateSpeech(
  settings: AppSettings,
  text: string,
  voiceId: string,
  options?: GenerateSpeechOptions
): Promise<TtsResult> {
  if (!text.trim()) throw new Error("El texto de la voz está vacío");
  const voice = getVoiceDef(voiceId);
  const signal = options?.signal;

  // 1. Caché exacta → resultado instantáneo
  const cacheKey = `${voice.id}::${await hashText(text)}`;
  const cached = await getCachedVoice(cacheKey);
  if (cached && cached.size > 1024) {
    try {
      options?.onProgress?.(1, 1);
      return await finalizeTts(cached, "caché");
    } catch {
      /* caché inválida: regeneramos */
    }
  }

  // 2. Proveedores disponibles para ESTA voz y dispositivo
  const attempts: { name: string; run: (chunk: string) => Promise<{ blob: Blob; provider: string }> }[] = [];
  if (hasBackend()) {
    attempts.push({ name: "servidor-de-voz", run: (chunk) => synthViaBackend(voice, chunk, signal) });
  }
  if (settings.ttsApiKey) {
    attempts.push({ name: "elevenlabs-clave-propia", run: (chunk) => synthViaOwnKey(settings.ttsApiKey, voice, chunk, signal) });
  }
  if (!isMobileDevice() && voice.kokoroVoice) {
    attempts.push({
      name: "kokoro-local",
      run: async (chunk) => ({ blob: await synthesizeChunkLocal(chunk, voice.kokoroVoice!, signal), provider: "kokoro-local" }),
    });
  }

  if (!attempts.length) {
    throw new Error(
      "La voz necesita el servidor de voz o una clave propia. Configúralo en Ajustes → Voz."
    );
  }

  // 3. Frase a frase: progreso REAL + fallback entre proveedores
  const chunks = splitForTts(text, 220);
  const total = chunks.length;
  options?.onProgress?.(0, total);
  const parts: Blob[] = [];
  let stickyProvider: string | null = null;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException("cancelado", "AbortError");
    const sticky: string | null = stickyProvider;
    const order: { name: string; run: (chunk: string) => Promise<{ blob: Blob; provider: string }> }[] = sticky
      ? [...attempts].sort((a, b) => (a.name === sticky ? -1 : b.name === sticky ? 1 : 0))
      : attempts;
    let got: { blob: Blob; provider: string } | null = null;
    const chunkErrs: string[] = [];
    for (const attempt of order) {
      try {
        got = await attempt.run(chunks[i]);
        stickyProvider = attempt.name;
        break;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        chunkErrs.push(`${attempt.name}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    if (!got) throw new Error(`No se pudo generar la voz → ${chunkErrs.join(" · ")}`);
    parts.push(got.blob);
    options?.onProgress?.(i + 1, total); // frase REAL completada
  }

  const merged = parts.length === 1 ? parts[0] : new Blob(parts, { type: parts[0].type || "audio/mpeg" });
  const result = await finalizeTts(merged, stickyProvider || "desconocido");
  void putCachedVoice(cacheKey, result.blob);
  return result;
}

// ===== Vista previa REAL (mismo pipeline que el vídeo final) =====
let previewAudio: HTMLAudioElement | null = null;
let previewAbort: AbortController | null = null;

export async function previewVoice(voiceOrId: VoiceOption | string): Promise<boolean> {
  stopPreview();
  if (typeof window === "undefined") return false;
  const id = typeof voiceOrId === "string" ? voiceOrId : voiceOrId.id;
  previewAbort = new AbortController();
  try {
    const { loadSettings } = await import("@/lib/storage");
    const settings = loadSettings();
    const voice = getVoiceDef(id);
    const line = SAMPLE_LINES[voice.locale] ?? SAMPLE_LINES["es-ES"];
    const result = await generateSpeech(settings, line, id, { signal: previewAbort.signal });
    previewAudio = new Audio(result.url);
    previewAudio.onended = () => stopPreview();
    await previewAudio.play();
    return true;
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      console.warn("[preview]", e); // detalle técnico solo en consola
    }
    previewAudio = null;
    previewAbort = null;
    return false;
  }
}

export function stopPreview() {
  try {
    previewAbort?.abort();
  } catch {}
  previewAbort = null;
  if (previewAudio) {
    try {
      previewAudio.pause();
      if (previewAudio.src.startsWith("blob:")) URL.revokeObjectURL(previewAudio.src);
    } catch {}
    previewAudio = null;
  }
}

/** ¿Hay vía REAL de generar esta voz? (para UI honesta) */
export function voiceAvailability(
  settings: AppSettings,
  voiceId: string
): { available: boolean; reason: string; providerLabel: string } {
  const v = getVoiceDef(voiceId);
  if (hasBackend()) {
    return { available: true, reason: "", providerLabel: "Servidor de voz" };
  }
  if (settings.ttsApiKey) {
    return { available: true, reason: "", providerLabel: "ElevenLabs · tu clave" };
  }
  if (!isMobileDevice() && v.kokoroVoice) {
    return { available: true, reason: "", providerLabel: "Voz local (escritorio)" };
  }
  return {
    available: false,
    reason: "Necesita el servidor de voz o una clave propia (Ajustes → Voz).",
    providerLabel: "Sin servidor de voz",
  };
}

export function localeOfVoice(voiceId: string): string {
  return getVoiceDef(voiceId).locale;
}

export function languageNameOfVoice(voiceId: string): string {
  return getVoiceDef(voiceId).language;
}
