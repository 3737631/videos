import type { AppSettings, VoiceOption } from "@/types";
import { serviceStatus } from "@/lib/storage";

export interface TtsResult {
  blob: Blob;
  url: string;
  duration: number;
  provider: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // Voces en INGLÃ‰S (ideales para contenido viral en EE.UU./global)
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
 * PrevisualizaciÃ³n GRATUITA de voz usando el sintetizador del navegador.
 * No necesita claves de API ni consume crÃ©ditos.
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

const ELEVENLABS_VOICE_MAP: Record<string, string> = {
  alloy: "21m00Tcm4TlvDq8ikWAM",
  echo: "29vD33N1CtxCmqQRPOHJ",
  fable: "JBFqnCBsd6RMkjVDRZzb",
  onyx: "VR6AewLTigWG4xSOukaG",
  nova: "EXAVITQu4vr4xnSDxMaL",
  shimmer: "LcfcDJNUP1GQjkzn1xUU",
};

export async function generateSpeech(
  settings: AppSettings,
  text: string,
  voiceId: string,
  options?: { speed?: number }
): Promise<TtsResult> {
  if (!text.trim()) throw new Error("El texto de la voz estÃ¡ vacÃ­o");

  const status = serviceStatus(settings, "tts");
  if (status.configured) {
    try {
      if (settings.ttsProvider === "elevenlabs") {
        return await generateElevenLabs(settings, text, voiceId, options);
      }
      return await generateOpenAi(settings, text, voiceId, options);
    } catch (e) {
      // Respaldo gratuito para que el vÃ­deo NUNCA salga sin voz
      try {
        return await generateGoogleTts(text);
      } catch {
        throw e;
      }
    }
  }

  // Sin clave configurada: voz gratuita directa
  return generateGoogleTts(text);
}

// Respaldo gratuito (voz de Google Translate vÃ­a proxies con CORS abierto)
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

async function generateGoogleTts(text: string): Promise<TtsResult> {
  const chunks = splitForTts(text, 190);
  const parts: Blob[] = [];
  for (const chunk of chunks) {
    const target =
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=en&q=${encodeURIComponent(chunk)}`;
    let got: Blob | null = null;
    for (const wrap of GTX_PROXIES) {
      try {
        const res = await fetch(wrap(target));
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

async function generateOpenAi(
  settings: AppSettings,
  text: string,
  voiceId: string,
  options?: { speed?: number }
): Promise<TtsResult> {
  const speed = options?.speed && options.speed > 0 ? Math.min(4, Math.max(0.25, options.speed)) : 1;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.ttsApiKey}`,
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: voiceId || settings.ttsVoiceId || "alloy",
      input: text,
      response_format: "mp3",
      speed,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new Error(
      retryable
        ? `El servicio TTS estÃ¡ sobrecargado (${res.status}). Reintenta.`
        : `Error TTS (${res.status}): ${body.slice(0, 200)}`
    );
  }
  const blob = await res.blob();
  return finalizeTts(blob, "openai");
}

async function generateElevenLabs(
  settings: AppSettings,
  text: string,
  voiceId: string,
  options?: { speed?: number }
): Promise<TtsResult> {
  const speed = options?.speed && options.speed > 0 ? options.speed : 1;
  const elVoiceId = ELEVENLABS_VOICE_MAP[voiceId] || voiceId;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": settings.ttsApiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 && body.includes("missing_permissions")) {
      throw new Error(
        "Tu clave de ElevenLabs NO tiene el permiso text_to_speech. Crea una clave nueva en elevenlabs.io con todos los permisos."
      );
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new Error(
      retryable
        ? `El servicio TTS estÃ¡ sobrecargado (${res.status}). Reintenta.`
        : `Error TTS ElevenLabs (${res.status}): ${body.slice(0, 200)}`
    );
  }
  const blob = await res.blob();
  return finalizeTts(blob, "elevenlabs");
}

async function finalizeTts(blob: Blob, provider: string): Promise<TtsResult> {
  if (!blob.size || blob.size < 1024) {
    throw new Error("El proveedor TTS devolviÃ³ un archivo vacÃ­o o invÃ¡lido. Reintenta.");
  }
  const url = URL.createObjectURL(blob);
  const duration = await probeAudioDuration(url);
  if (duration < 0.5) {
    URL.revokeObjectURL(url);
    throw new Error("El audio generado es demasiado corto o no contiene voz vÃ¡lida.");
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
