/**
 * Cliente del SERVIDOR DE VOZ (backend propio).
 *
 * ARQUITECTURA: navegador → worker propio → proveedores TTS/LLM/STT.
 * Las claves reales viven SOLO como secretos del worker (Cloudflare).
 * NUNCA se usan proxies CORS públicos ni endpoints no oficiales.
 * La URL del backend NO es un secreto; se configura en public/config.js
 * o en la variable NEXT_PUBLIC_TTS_API_URL en build.
 */

export interface RuntimeConfig {
  apiBaseUrl?: string;
}

declare global {
  interface Window {
    __CLIPCRAFT__?: RuntimeConfig;
  }
}

let overrideUrlForTests: string | null = null;

/** URL del backend (runtime config > env de build > test hook). "" si no hay. */
export function apiBaseUrl(): string {
  if (overrideUrlForTests !== null) return overrideUrlForTests.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.__CLIPCRAFT__?.apiBaseUrl) {
    return window.__CLIPCRAFT__.apiBaseUrl.replace(/\/+$/, "");
  }
  const env = process.env.NEXT_PUBLIC_TTS_API_URL;
  return env ? env.replace(/\/+$/, "") : "";
}

/** Solo para tests automatizados */
export function setApiBaseUrlForTests(url: string | null): void {
  overrideUrlForTests = url === null ? null : url.replace(/\/+$/, "");
}

export function hasBackend(): boolean {
  return apiBaseUrl() !== "";
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`sin respuesta en ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
  }
}

/**
 * fetch con SIEMPRE limpieza de timer y terminación garantizada:
 * resuelve, rechaza por red, o aborta por timeout. Nunca queda pendiente.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 30000
): Promise<Response> {
  const externalSignal = init.signal ?? null;
  const ctrl = new AbortController();
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (externalSignal?.aborted) throw e; // cancelación real del usuario
    if (!externalSignal && e instanceof DOMException && e.name === "AbortError") {
      throw new TimeoutError(ms);
    }
    throw e;
  } finally {
    clearTimeout(timer); // LIMPIEZA GARANTIZADA del timer
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* cuerpo no JSON */
  }
  return `HTTP ${res.status}`;
}

function assertAudio(blob: Blob): Blob {
  const okType =
    blob.type.startsWith("audio/") ||
    blob.type === "application/octet-stream" ||
    blob.type === "";
  if (!okType) throw new Error(`el servidor no devolvió audio (${blob.type || "tipo desconocido"})`);
  if (blob.size < 800) throw new Error("el servidor devolvió un audio vacío");
  return blob;
}

/** POST /tts → audio Blob (multipart-free, JSON in / binary out) */
export async function ttsViaBackend(
  text: string,
  providerVoiceId: string,
  locale: string,
  signal?: AbortSignal,
  timeoutMs = 45000
): Promise<Blob> {
  const base = apiBaseUrl();
  if (!base) throw new Error("servidor de voz no configurado");
  const res = await fetchWithTimeout(
    `${base}/tts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId: providerVoiceId, locale }),
      signal,
    },
    timeoutMs
  );
  if (!res.ok) throw new Error(await readError(res));
  return assertAudio(await res.blob());
}

/** POST /llm → texto generado (proxy Groq con clave en el servidor) */
export async function llmViaBackend(
  messages: { role: "system" | "user"; content: string }[],
  model: string,
  maxTokens: number,
  signal?: AbortSignal,
  timeoutMs = 60000
): Promise<string> {
  const base = apiBaseUrl();
  if (!base) throw new Error("servidor de voz no configurado");
  const res = await fetchWithTimeout(
    `${base}/llm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model, maxTokens }),
      signal,
    },
    timeoutMs
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { content?: string };
  if (!data.content) throw new Error("el servidor no devolvió contenido");
  return data.content.trim();
}

/** POST /stt multipart → verbose_json con palabras */
export async function sttViaBackend(
  audio: Blob,
  language: string,
  signal?: AbortSignal,
  timeoutMs = 90000
): Promise<{
  words?: Array<{ word?: string; start?: number; end?: number }>;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
}> {
  const base = apiBaseUrl();
  if (!base) throw new Error("servidor de voz no configurado");
  const form = new FormData();
  form.append("file", audio, "voice.webm");
  form.append("language", language);
  const res = await fetchWithTimeout(`${base}/stt`, { method: "POST", body: form, signal }, timeoutMs);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as {
    words?: Array<{ word?: string; start?: number; end?: number }>;
    segments?: Array<{ text?: string; start?: number; end?: number }>;
  };
}

/**
 * Traduce errores técnicos a mensajes que una persona entiende.
 * El detalle técnico queda en consola/registro, nunca en la interfaz.
 */
export function toFriendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (e instanceof DOMException && e.name === "AbortError") return "Operación cancelada.";
  if (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("networkerror") ||
    lower.includes("fetch failed")
  ) {
    return "No hay conexión con el servidor de voz. Comprueba tu internet (o desactiva la VPN) y vuelve a intentarlo.";
  }
  if (lower.includes("429")) return "El servidor está ocupado ahora mismo. Espera un minuto y vuelve a probar.";
  if (lower.includes("timeout") || lower.includes("tardó demasiado") || lower.includes("sin respuesta")) {
    return "Tardó demasiado. Revisa tu conexión e inténtalo otra vez; si sigue fallando, prueba con un texto más corto.";
  }
  return "Algo salió mal. Inténtalo de nuevo en unos segundos.";
}
