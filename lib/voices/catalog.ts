/**
 * CATÁLOGO V3 — solo voces GRATIS y LOCALES (sin claves, sin créditos):
 *  · runtime "kokoro" → Kokoro-82M en el navegador (inglés; modelo compartido ~92 MB)
 *  · runtime "piper"  → Piper ONNX en el navegador (ES/FR/DE/IT/PT-BR)
 * Nombres REALES de las voces (ningún nombre inventado) y tamaños reales.
 */

export type VoiceRuntime = "kokoro" | "piper";

export interface CatalogVoice {
  id: string;
  /** Nombre real del modelo/voz */
  name: string;
  gender: "femenina" | "masculina";
  locale: string;
  country: string;
  flag: string;
  style: string;
  runtime: VoiceRuntime;
  sizeBytes: number;
  sampleText: string;
  modelUrl?: string;
  configUrl?: string;
  speakerId?: number;
}

const PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0";

/** Ruta de los modelos de voz auto-alojados (mismo origen, sin CORS). */
export function voiceRoot(): string {
  if (typeof window === "undefined") return "/voices/";
  const base = window.location.pathname.startsWith("/videos") ? "/videos" : "";
  return base + "/voices/";
}

/** Marca "local:..." → se resuelve contra el origen en tiempo de descarga. */
export function resolveVoiceUrl(u?: string): string | undefined {
  if (!u) return u;
  if (u.startsWith("local:")) return voiceRoot() + u.slice("local:".length);
  return u;
}

function piper(
  path: string,
  id: string,
  name: string,
  gender: "femenina" | "masculina",
  locale: string,
  country: string,
  flag: string,
  style: string,
  sizeBytes: number,
  sampleText: string,
  speakerId?: number
): CatalogVoice {
  const url = `${PIPER_BASE}/${path}`;
  return {
    id,
    name,
    gender,
    locale,
    country,
    flag,
    style,
    runtime: "piper",
    sizeBytes,
    sampleText,
    modelUrl: `${url}.onnx`,
    configUrl: `${url}.onnx.json`,
    ...(speakerId !== undefined ? { speakerId } : {}),
  };
}

export const VOICE_CATALOG: CatalogVoice[] = [
  // ── Español ──────────────────────────────────────────────────────────
  piper(
    "es/es_ES/carlfm/x_low/es_ES-carlfm-x_low", "es_ES-carlfm-x_low", "Carlfm", "masculina",
    "es-ES", "España", "🇪🇸", "Joven, directa, ideal para TikTok Shop", 28_130_791,
    "Este gadget lo cambia todo en tu cocina. Mira lo que hace."
  ),
  piper(
    "es/es_ES/sharvard/medium/es_ES-sharvard-medium", "es_ES-sharvard-medium", "Sharvard", "femenina",
    "es-ES", "España", "🇪🇸", "Cálida y profesional, perfecta para reseñas", 76_733_615,
     "Lo probé durante treinta días y el resultado me sorprendió.",
    0
  ),
  // ── Inglés (Kokoro, modelo compartido) ───────────────────────────────
  {
    id: "af_heart", name: "Heart", gender: "femenina", locale: "en-US", country: "Estados Unidos",
    flag: "🇺🇸", style: "Expresiva y potente, la voz insignia", runtime: "kokoro",
    sizeBytes: 92_361_116,
    sampleText: "This little gadget changed my kitchen forever. Look at this!",
  },
  {
    id: "af_bella", name: "Bella", gender: "femenina", locale: "en-US", country: "Estados Unidos",
    flag: "🇺🇸", style: "Vibrante, estilo creadora de contenido", runtime: "kokoro",
    sizeBytes: 0, // comparte modelo con Heart
    sampleText: "Wait for it… this is the best ten dollars I ever spent.",
  },
  {
    id: "am_michael", name: "Michael", gender: "masculina", locale: "en-US", country: "Estados Unidos",
    flag: "🇺🇸", style: "Clara y segura, ideal para demos", runtime: "kokoro",
    sizeBytes: 0,
    sampleText: "Here is why everyone is buying this in twenty twenty six.",
  },
  {
    id: "bf_emma", name: "Emma", gender: "femenina", locale: "en-GB", country: "Reino Unido",
    flag: "🇬🇧", style: "Elegante acento británico", runtime: "kokoro",
    sizeBytes: 0,
    sampleText: "Brilliant. Absolutely brilliant value for money.",
  },
  // ── Francés ──────────────────────────────────────────────────────────
  piper(
    "fr/fr_FR/siwis/medium/fr_FR-siwis-medium", "fr_FR-siwis-medium", "Siwis", "femenina",
    "fr-FR", "Francia", "🇫🇷", "Suave y natural, estilo vlog", 63_201_294,
    "Ce gadget va changer votre cuisine. Regardez bien."
  ),
  // ── Alemán ───────────────────────────────────────────────────────────
  piper(
    "de/de_DE/thorsten-low/de_DE-thorsten-low", "de_DE-thorsten-low", "Thorsten", "masculina",
    "de-DE", "Alemania", "🇩🇪", "Directa y clara, estilo review", 63_104_526,
    "Dieses Gadget verändert deine Küche. Schau dir das an."
  ),
  piper(
    "de/de_DE/ramona-low/de_DE-ramona-low", "de_DE-ramona-low", "Ramona", "femenina",
    "de-DE", "Alemania", "🇩🇪", "Cálida, ideal para unboxing", 63_104_526,
    "Ich habe es dreißig Tage getestet und bin begeistert."
  ),
  // ── Italiano ─────────────────────────────────────────────────────────
  piper(
    "it/it_IT/riccardo/x_low/it_IT-riccardo-x_low", "it_IT-riccardo-x_low", "Riccardo", "masculina",
    "it-IT", "Italia", "🇮🇹", "Enérgica, perfecta para ofertas", 28_130_791,
    "Questo gadget cambierà la tua cucina. Guarda che fa!"
  ),
  // ── Portugués (Brasil) ───────────────────────────────────────────────
  piper(
    "pt/pt_BR/faber/medium/pt_BR-faber-medium", "pt_BR-faber-medium", "Faber", "masculina",
    "pt-BR", "Brasil", "🇧🇷", "Animada, estilo criador de conteúdo", 63_201_294,
    "Esse gadget vai mudar a sua cozinha. Olha isso!"
  ),
];

// Voces en español auto-alojadas (mismo origen): cero dependencia externa.
for (const v of VOICE_CATALOG) {
  if (v.id === "es_ES-carlfm-x_low") {
    v.modelUrl = "local:es_ES-carlfm-x_low.onnx";
    v.configUrl = "local:es_ES-carlfm-x_low.onnx.json";
  }
}

export function getVoiceById(id: string): CatalogVoice | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}

export function voicesByLanguage(langPrefix: string): CatalogVoice[] {
  return VOICE_CATALOG.filter((v) => v.locale.toLowerCase().startsWith(langPrefix.toLowerCase()));
}

/** Alternativas del MISMO idioma para el fallback inteligente */
export function sameLanguageAlternates(id: string): CatalogVoice[] {
  const v = getVoiceById(id);
  if (!v) return [];
  return VOICE_CATALOG.filter((x) => x.locale === v.locale && x.id !== id);
}

export const DEFAULT_VOICE_BY_LANG: Record<string, string> = {
  es: "es_ES-carlfm-x_low",
  en: "af_heart",
  fr: "fr_FR-siwis-medium",
  de: "de_DE-thorsten-low",
  it: "it_IT-riccardo-x_low",
  pt: "pt_BR-faber-medium",
};

export function defaultVoiceForLocale(locale: string): string {
  const lang = (locale || "es").slice(0, 2).toLowerCase();
  return DEFAULT_VOICE_BY_LANG[lang] || "es_ES-carlfm-x_low";
}

/** Tamaño real que falta por descargar (0 = ya instalada / sin coste extra) */
export function missingBytesFor(voiceId: string, installedBytes: number): number {
  const v = getVoiceById(voiceId);
  if (!v) return 0;
  if (installedBytes > 0) return 0;
  return v.runtime === "kokoro" ? v.sizeBytes : v.sizeBytes;
}

export function formatMB(bytes: number): string {
  if (!bytes) return "—";
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
