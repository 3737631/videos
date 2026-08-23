/**
 * Proveedores TTS con contrato uniforme. TODOS:
 * - usan AbortController con timeout propio,
 * - comprueban HTTP status y tamaño del audio,
 * - resuelven o rechazan SIEMPRE (nunca quedan pendientes).
 *
 * ARQUITECTURA EN GITHUB PAGES (estático):
 * No existe backend, así que NO se puede guardar ninguna API key en el cliente.
 * El proveedor "api" solo se activa si defines NEXT_PUBLIC_TTS_API_URL apuntando
 * a TU proxy (Vercel/Cloudflare Worker) que guarda la clave en el servidor.
 * Sin esa variable, se usa la cadena gratuita: Google-gtx vía proxies CORS
 * abiertos y, como último recurso, el worker público TikTok-TTS.
 */
import { getVoiceDef } from "./voices";

export interface TtsProviderResult {
  blob: Blob;
  provider: string;
}

export interface TtsProvider {
  name: string;
  /** Devuelve el audio o lanza Error con el motivo real */
  synthesize(text: string, voiceId: string): Promise<TtsProviderResult>;
}

function withTimeout(ms: number): { signal: AbortSignal; done: Promise<void> } {
  const ctrl = new AbortController();
  const done = new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        ctrl.abort();
      } catch {}
      resolve();
    }, ms);
  });
  return { signal: ctrl.signal, done };
}

async function fetchAudio(url: string, ms: number, init?: RequestInit): Promise<Blob> {
  const { signal, done } = withTimeout(ms);
  try {
    const race = await Promise.race([fetch(url, { ...init, signal }), done.then(() => null)]);
    if (!race) throw new Error(`sin respuesta en ${ms / 1000}s`);
    if (!race.ok) throw new Error(`HTTP ${race.status}`);
    const blob = await race.blob();
    if (blob.size < 800) throw new Error("respuesta demasiado pequeña para ser audio");
    return blob;
  } finally {
    // `done` siempre termina; abort garantiza que fetch no quede colgado
  }
}

// ===== 1) API propia opcional (proxy con clave en servidor; sin clave en cliente) =====
const API_URL = process.env.NEXT_PUBLIC_TTS_API_URL;

export const apiProvider: TtsProvider | null = API_URL
  ? {
      name: "api-proxy",
      synthesize: async (text, voiceId) => {
        const v = getVoiceDef(voiceId);
        const blob = await fetchAudio(API_URL!, 20000, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: v.apiVoice || v.gtxLang }),
        });
        return { blob, provider: "api-proxy" };
      },
    }
  : null;

// ===== 2) Gratuito: Google Translate TTS vía proxies CORS abiertos =====
const GTX_PROXIES: Array<(u: string) => string> = [
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

export function splitText(text: string, maxLen: number): string[] {
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

export const googleGtxProvider: TtsProvider = {
  name: "google-gtx",
  synthesize: async (text, voiceId) => {
    const v = getVoiceDef(voiceId);
    const chunks = splitText(text, 180);
    const parts: Blob[] = [];
    for (const chunk of chunks) {
      const target =
        `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${v.gtxLang}` +
        `&q=${encodeURIComponent(chunk)}`;
      let got: Blob | null = null;
      const errs: string[] = [];
      for (const wrap of GTX_PROXIES) {
        try {
          got = await fetchAudio(wrap(target), 10000);
          break;
        } catch (e) {
          errs.push(e instanceof Error ? e.message : "proxy");
        }
      }
      if (!got) throw new Error(`gtx sin proxies (${errs.join(" | ")})`);
      parts.push(got);
      if (chunks.length > 1) await new Promise((r) => setTimeout(r, 250));
    }
    const blob = parts.length === 1 ? parts[0] : new Blob(parts, { type: "audio/mpeg" });
    return { blob, provider: "google-gtx" };
  },
};

// ===== 3) Último recurso gratuito (inglés): worker público TikTok-TTS =====
function b64ToBlob(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "audio/mpeg" });
}

export const tiktokProvider: TtsProvider = {
  name: "tiktok-tts",
  synthesize: async (text, voiceId) => {
    const v = getVoiceDef(voiceId);
    if (!v.tiktokVoice) throw new Error("voz no disponible en tiktok-tts");
    const chunks = splitText(text, 110);
    const parts: Blob[] = [];
    for (const chunk of chunks) {
      const { signal, done } = withTimeout(12000);
      let json: { success?: boolean; data?: string; message?: string };
      try {
        const raced = await Promise.race([
          fetch("https://tiktok-tts.weilnet.workers.dev/api/generation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: chunk, voice: v.tiktokVoice }),
            signal,
          }),
          done.then(() => null),
        ]);
        if (!raced) throw new Error("sin respuesta en 12s");
        if (!raced.ok) throw new Error(`HTTP ${raced.status}`);
        json = await raced.json();
      } finally {
        // timeout ya garantizado por withTimeout
      }
      if (!json.success || !json.data) throw new Error(json.message || "sin datos");
      const blob = b64ToBlob(json.data);
      if (blob.size < 800) throw new Error("audio vacío");
      parts.push(blob);
      if (chunks.length > 1) await new Promise((r) => setTimeout(r, 150));
    }
    const blob = parts.length === 1 ? parts[0] : new Blob(parts, { type: "audio/mpeg" });
    return { blob, provider: "tiktok-tts" };
  },
};

/** Cadena de proveedores según dispositivo (Kokoro SOLO escritorio) */
export function providerChain(isMobile: boolean): TtsProvider[] {
  const chain: TtsProvider[] = [];
  if (apiProvider) chain.push(apiProvider);
  if (isMobile) {
    chain.push(googleGtxProvider, tiktokProvider);
  } else {
    chain.push(googleGtxProvider, tiktokProvider); // Kokoro se inserta antes en tts.ts
  }
  return chain;
}
