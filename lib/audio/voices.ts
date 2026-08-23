/**
 * Catálogo de VOCES multiidioma disponible AL INSTANTE (solo metadatos, cero
 * descargas). El audio se genera únicamente para la voz elegida en el momento
 * de crear el vídeo.
 */
export interface VoiceDef {
  id: string;
  name: string;
  /** Grupo de idioma para la UI */
  language: string;
  langLabel: string;
  gender: "femenina" | "masculina" | "neutra";
  accent: string;
  /** Código de idioma para el proveedor gratuito Google-gtx */
  gtxLang: string;
  /** Voz equivalente del worker TikTok-TTS (solo existe para inglés) */
  tiktokVoice?: string;
  /** Nombre de voz para una API propia/proxy configurado (p.ej. Google Cloud TTS) */
  apiVoice?: string;
}

export const VOICES: VoiceDef[] = [
  // English
  { id: "en-US-f", name: "Ava", language: "English", langLabel: "🇺🇸 English US", gender: "femenina", accent: "US", gtxLang: "en", tiktokVoice: "en_us_001", apiVoice: "en-US-Standard-C" },
  { id: "en-US-m", name: "Caleb", language: "English", langLabel: "🇺🇸 English US", gender: "masculina", accent: "US", gtxLang: "en", tiktokVoice: "en_us_010", apiVoice: "en-US-Standard-D" },
  { id: "en-GB-f", name: "Libby", language: "English", langLabel: "🇬🇧 English UK", gender: "femenina", accent: "UK", gtxLang: "en", tiktokVoice: "en_us_002", apiVoice: "en-GB-Standard-A" },
  { id: "en-GB-m", name: "Oliver", language: "English", langLabel: "🇬🇧 English UK", gender: "masculina", accent: "UK", gtxLang: "en", tiktokVoice: "en_male_cody", apiVoice: "en-GB-Standard-B" },
  // Español
  { id: "es-ES-f", name: "Lucía", language: "Español", langLabel: "🇪🇸 Español España", gender: "femenina", accent: "ES", gtxLang: "es", apiVoice: "es-ES-Standard-A" },
  { id: "es-ES-m", name: "Mateo", language: "Español", langLabel: "🇪🇸 Español España", gender: "masculina", accent: "ES", gtxLang: "es", apiVoice: "es-ES-Standard-B" },
  { id: "es-MX-f", name: "Valentina", language: "Español", langLabel: "🇲🇽 Español Latino", gender: "femenina", accent: "MX", gtxLang: "es", apiVoice: "es-MX-Standard-A" },
  { id: "es-MX-m", name: "Diego", language: "Español", langLabel: "🇲🇽 Español Latino", gender: "masculina", accent: "MX", gtxLang: "es", apiVoice: "es-MX-Standard-B" },
  // Français
  { id: "fr-FR-f", name: "Camille", language: "Français", langLabel: "🇫🇷 Français", gender: "femenina", accent: "FR", gtxLang: "fr", apiVoice: "fr-FR-Standard-A" },
  { id: "fr-FR-m", name: "Louis", language: "Français", langLabel: "🇫🇷 Français", gender: "masculina", accent: "FR", gtxLang: "fr", apiVoice: "fr-FR-Standard-B" },
  // Deutsch
  { id: "de-DE-f", name: "Lena", language: "Deutsch", langLabel: "🇩🇪 Deutsch", gender: "femenina", accent: "DE", gtxLang: "de", apiVoice: "de-DE-Standard-A" },
  { id: "de-DE-m", name: "Jonas", language: "Deutsch", langLabel: "🇩🇪 Deutsch", gender: "masculina", accent: "DE", gtxLang: "de", apiVoice: "de-DE-Standard-B" },
  // Italiano
  { id: "it-IT-f", name: "Giulia", language: "Italiano", langLabel: "🇮🇹 Italiano", gender: "femenina", accent: "IT", gtxLang: "it", apiVoice: "it-IT-Standard-A" },
  { id: "it-IT-m", name: "Marco", language: "Italiano", langLabel: "🇮🇹 Italiano", gender: "masculina", accent: "IT", gtxLang: "it", apiVoice: "it-IT-Standard-B" },
  // Português
  { id: "pt-BR-f", name: "Beatriz", language: "Português", langLabel: "🇧🇷 Português", gender: "femenina", accent: "BR", gtxLang: "pt", apiVoice: "pt-BR-Standard-A" },
  { id: "pt-BR-m", name: "Thiago", language: "Português", langLabel: "🇧🇷 Português", gender: "masculina", accent: "BR", gtxLang: "pt", apiVoice: "pt-BR-Standard-B" },
];

export function getVoiceDef(id: string): VoiceDef {
  return VOICES.find((v) => v.id === id) || VOICES[0];
}
