/**
 * FUENTE ÚNICA DE VERDAD del catálogo de voces.
 *
 * Cada voz declara su `providerVoiceId` REAL del proveedor TTS
 * (ElevenLabs, voces premade oficiales de elevenlabs.io — no se inventa
 * ninguna). El pipeline resuelve: VOICE_CATALOG → id elegido →
 * providerVoiceId → TTS. NUNCA se mapea un idioma a una voz de otro idioma.
 *
 * `kokoroVoice` existe SOLO para inglés como respaldo local de escritorio
 * (el modelo Kokoro es angloparlante); el resto de idiomas requiere el
 * servidor de voz o una clave propia. Kokoro jamás se usa en móvil.
 */
export interface VoiceDef {
  /** ID estable del catálogo (p.ej. "es-ES-f"). Se guarda en ajustes. */
  id: string;
  /** Nombre real de la voz del proveedor */
  name: string;
  /** Grupo UI: "English" | "Español" | "Français" | "Deutsch" | "Italiano" | "Português" */
  language: string;
  langLabel: string;
  /** BCP-47: define idioma de la voz Y de los subtítulos */
  locale: string;
  gender: "femenina" | "masculina";
  accent: string;
  /** voice_id REAL de ElevenLabs (premade voices) */
  providerVoiceId: string;
  /** Respaldo local de escritorio, SOLO para voces inglesas */
  kokoroVoice?: string;
}

export const VOICES: VoiceDef[] = [
  // ── English US ──
  { id: "en-US-f", name: "Laura", language: "English", langLabel: "🇺🇸 English US", locale: "en-US", gender: "femenina", accent: "US", providerVoiceId: "FGY2WhTYpPnrIDTdsKH5", kokoroVoice: "af_heart" },
  { id: "en-US-m", name: "Brian", language: "English", langLabel: "🇺🇸 English US", locale: "en-US", gender: "masculina", accent: "US", providerVoiceId: "nPczCjzI2devNBz1zQrb", kokoroVoice: "am_michael" },
  // ── English UK ──
  { id: "en-GB-f", name: "Lily", language: "English", langLabel: "🇬🇧 English UK", locale: "en-GB", gender: "femenina", accent: "UK", providerVoiceId: "pFZP5JQG7iQjIQuC4Bku", kokoroVoice: "bf_emma" },
  { id: "en-GB-m", name: "Daniel", language: "English", langLabel: "🇬🇧 English UK", locale: "en-GB", gender: "masculina", accent: "UK", providerVoiceId: "onwK4e9ZLuTAKqWW03F9", kokoroVoice: "bm_george" },
  // ── Español España ──
  { id: "es-ES-f", name: "Matilda", language: "Español", langLabel: "🇪🇸 Español España", locale: "es-ES", gender: "femenina", accent: "ES", providerVoiceId: "XrExE9yKIg1WjnnlVkGX" },
  { id: "es-ES-m", name: "Antoni", language: "Español", langLabel: "🇪🇸 Español España", locale: "es-ES", gender: "masculina", accent: "ES", providerVoiceId: "ErXwobaYiN019PkySvjV" },
  // ── Español Latino ──
  { id: "es-MX-f", name: "Charlotte", language: "Español", langLabel: "🇲🇽 Español Latino", locale: "es-MX", gender: "femenina", accent: "MX", providerVoiceId: "XB0fDUnXU5powFXDhCwa" },
  { id: "es-MX-m", name: "Josh", language: "Español", langLabel: "🇲🇽 Español Latino", locale: "es-MX", gender: "masculina", accent: "MX", providerVoiceId: "TxGEqnHWrfWFTfGW9XjX" },
  // ── Français ──
  { id: "fr-FR-f", name: "Elli", language: "Français", langLabel: "🇫🇷 Français", locale: "fr-FR", gender: "femenina", accent: "FR", providerVoiceId: "MF3mGyEYCl7XYWbV9V6O" },
  { id: "fr-FR-m", name: "Thomas", language: "Français", langLabel: "🇫🇷 Français", locale: "fr-FR", gender: "masculina", accent: "FR", providerVoiceId: "GBv7mTt0atIp3Br8iCZE" },
  // ── Deutsch ──
  { id: "de-DE-f", name: "Sarah", language: "Deutsch", langLabel: "🇩🇪 Deutsch", locale: "de-DE", gender: "femenina", accent: "DE", providerVoiceId: "EXAVITQu4vr4xnSDxMaL" },
  { id: "de-DE-m", name: "Adam", language: "Deutsch", langLabel: "🇩🇪 Deutsch", locale: "de-DE", gender: "masculina", accent: "DE", providerVoiceId: "pNInz6obpgDQGcFmaJgB" },
  // ── Italiano ──
  { id: "it-IT-f", name: "Grace", language: "Italiano", langLabel: "🇮🇹 Italiano", locale: "it-IT", gender: "femenina", accent: "IT", providerVoiceId: "oWAxZDx7w5VEj9dCyTzz" },
  { id: "it-IT-m", name: "Liam", language: "Italiano", langLabel: "🇮🇹 Italiano", locale: "it-IT", gender: "masculina", accent: "IT", providerVoiceId: "TX3LPaxmHKxFdv7VOQHJ" },
  // ── Português ──
  { id: "pt-BR-f", name: "Serena", language: "Português", langLabel: "🇧🇷 Português", locale: "pt-BR", gender: "femenina", accent: "BR", providerVoiceId: "pMsXgVXv3BLzUgSXRplE" },
  { id: "pt-BR-m", name: "Charlie", language: "Português", langLabel: "🇧🇷 Português", locale: "pt-BR", gender: "masculina", accent: "BR", providerVoiceId: "IKne3meq5aSn9XLyUdCD" },
];

/** Compatibilidad: IDs legacy de OpenAI → voz equivalente del catálogo */
export const LEGACY_IDS: Record<string, string> = {
  alloy: "en-US-m",
  nova: "en-US-f",
  shimmer: "en-GB-f",
  echo: "en-US-m",
  onyx: "en-GB-m",
  fable: "en-US-m",
};

export function getVoiceDef(id: string): VoiceDef {
  const direct = VOICES.find((v) => v.id === id);
  if (direct) return direct;
  const legacy = LEGACY_IDS[id];
  if (legacy) return getVoiceDef(legacy);
  return VOICES[0];
}

/** Código de idioma ISO para STT/subtítulos a partir del locale de la voz */
export function sttLanguageFromLocale(locale: string): string {
  return (locale || "en").split("-")[0].toLowerCase();
}
