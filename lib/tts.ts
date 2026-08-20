import type { AppSettings, VoiceOption } from "@/types";
import { serviceStatus } from "@/lib/storage";

export interface TtsResult {
  blob: Blob;
  url: string;
  duration: number;
  provider: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  { id: "alloy", name: "Alloy", gender: "neutra", style: "Natural", language: "Español", accent: "Neutro", speed: 1 },
  { id: "echo", name: "Echo", gender: "masculina", style: "Profesional", language: "Español", accent: "Neutro", speed: 1 },
  { id: "fable", name: "Fable", gender: "neutra", style: "Storytelling", language: "Español", accent: "Neutro", speed: 1 },
  { id: "onyx", name: "Onyx", gender: "masculina", style: "Energética", language: "Español", accent: "Neutro", speed: 1 },
  { id: "nova", name: "Nova", gender: "femenina", style: "Natural", language: "Español", accent: "Neutro", speed: 1 },
  { id: "shimmer", name: "Shimmer", gender: "femenina", style: "UGC", language: "Español", accent: "Neutro", speed: 1 },
];

export async function generateSpeech(
  settings: AppSettings,
  text: string,
  voiceId: string,
  options?: { speed?: number }
): Promise<TtsResult> {
  const status = serviceStatus(settings, "tts");
  if (!status.configured) {
    throw new Error("Servicio TTS no configurado. Añade tu clave en Configuración (ttsApiKey).");
  }
  if (!text.trim()) throw new Error("El texto de la voz está vacío");

  if (settings.ttsProvider === "elevenlabs") {
    return generateElevenLabs(settings, text, voiceId, options);
  }
  return generateOpenAi(settings, text, voiceId, options);
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
        ? `El servicio TTS está sobrecargado (${res.status}). Reintenta.`
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
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
    const retryable = res.status === 429 || res.status >= 500;
    throw new Error(
      retryable
        ? `El servicio TTS está sobrecargado (${res.status}). Reintenta.`
        : `Error TTS ElevenLabs (${res.status}): ${body.slice(0, 200)}`
    );
  }
  const blob = await res.blob();
  return finalizeTts(blob, "elevenlabs");
}

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