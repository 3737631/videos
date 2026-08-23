/**
 * ESTILOS DE VOZ — SOLO parámetros que los motores soportan de verdad:
 * velocidad por rol del guion y pausas entre segmentos.
 * Piper/Kokoro NO tienen control emocional real: aquí no se finge lo contrario.
 */

export type SegmentRole =
  | "hook"
  | "problema"
  | "beneficio"
  | "demostracion"
  | "prueba"
  | "oferta"
  | "cta";

export type VoiceStyleId =
  | "natural"
  | "viral"
  | "energetico"
  | "storytelling"
  | "emocional"
  | "profesional"
  | "urgente";

export interface VoiceStyleDef {
  id: VoiceStyleId;
  label: string;
  desc: string;
  /** Multiplicador global de velocidad (1 = normal) */
  speedMul: number;
  /** Pausa base entre frases en ms */
  pauseMs: number;
  /** Velocidad extra por rol (se multiplica con speedMul) */
  roleSpeed: Partial<Record<SegmentRole, number>>;
}

export const VOICE_STYLES: VoiceStyleDef[] = [
  {
    id: "natural", label: "Natural", desc: "Ritmo normal y pausado",
    speedMul: 1, pauseMs: 220,
    roleSpeed: {},
  },
  {
    id: "viral", label: "Viral", desc: "Gancho rápido, cierre a tope",
    speedMul: 1.1, pauseMs: 140,
    roleSpeed: { hook: 1.12, cta: 1.08 },
  },
  {
    id: "energetico", label: "Energético", desc: "Todo a más velocidad",
    speedMul: 1.18, pauseMs: 110,
    roleSpeed: {},
  },
  {
    id: "storytelling", label: "Storytelling", desc: "Pausas que cuentan",
    speedMul: 0.96, pauseMs: 340,
    roleSpeed: { hook: 0.94 },
  },
  {
    id: "emocional", label: "Emocional", desc: "Lento y cercano",
    speedMul: 0.9, pauseMs: 380,
    roleSpeed: { cta: 0.92 },
  },
  {
    id: "profesional", label: "Profesional", desc: "Claro y estable",
    speedMul: 1, pauseMs: 240,
    roleSpeed: {},
  },
  {
    id: "urgente", label: "Urgente", desc: "Corre, oferta limitada",
    speedMul: 1.22, pauseMs: 90,
    roleSpeed: { oferta: 1.1, cta: 1.12 },
  },
];

export function getStyle(id: string | null | undefined): VoiceStyleDef {
  return VOICE_STYLES.find((s) => s.id === id) ?? VOICE_STYLES[0];
}

/** Velocidad efectiva de un rol, acotada a un rango sano para TTS */
export function roleSpeedOf(style: VoiceStyleDef, role: SegmentRole): number {
  const raw = style.speedMul * (style.roleSpeed[role] ?? 1);
  return Math.min(1.5, Math.max(0.7, Math.round(raw * 100) / 100));
}

// ── Segmentación HOOK→CTA ───────────────────────────────────────────────

const ROLE_HINTS: Array<[SegmentRole, RegExp]> = [
  ["hook", /^(espera|mira esto|para todo|esto es|no vas a creer|stop|atenci)/i],
  ["problema", /\b(problema|cansad|harto|odio|nunca funciona|difícil|dificil|fastidia)\b/i],
  ["beneficio", /\b(y lo mejor|gracias a|con esto|ahora puedes|imagina|ventaja)\b/i],
  ["demostracion", /\b(mira|fíjate|fijate|así funciona|asi funciona|mira cómo|mira como|paso a paso)\b/i],
  ["prueba", /\b(lo probé|he probado|reseñas|opiniones|miles de|resultados)\b/i],
  ["oferta", /\b(hoy|oferta|descuento|precio|rebaja|envío gratis|envio gratis|solo por)\b/i],
  ["cta", /\b(compra|enlace|link|pídelo|pidelo|córrelo|correlo|no esperes|agotarse|toca el)\b/i],
];

/** Divide el guion en frases y asigna un rol a cada una (heurística offline) */
export function segmentRoles(text: string): Array<{ role: SegmentRole; text: string }> {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.map((s, i) => {
    if (i === 0) return { role: "hook" as const, text: s };
    if (i === sentences.length - 1 && sentences.length > 1) return { role: "cta" as const, text: s };
    for (const [role, re] of ROLE_HINTS) {
      if (re.test(s)) return { role, text: s };
    }
    const mid = (i / Math.max(1, sentences.length - 1)) * 100;
    if (mid < 40) return { role: "problema" as const, text: s };
    if (mid < 75) return { role: "beneficio" as const, text: s };
    return { role: "oferta" as const, text: s };
  });
}

/** Tono recomendado según guion/nicho/duración (el usuario puede cambiarlo) */
export function recommendStyle(input: {
  scriptText: string;
  isDropshipping?: boolean;
  durationSec?: number | null;
}): VoiceStyleId {
  const t = input.scriptText.toLowerCase();
  if (/\b(corre|última hora|ultima hora|se agota|solo hoy|ya mismo|antes de que)\b/.test(t)) return "urgente";
  if (/\b(historia|un día|un dia|resulta que|sabías que|sabias que)\b/.test(t)) return "storytelling";
  if (/\b(emoción|emocion|especial para mí|especial para mi|me cambió|me cambio|gracias a)\b/.test(t)) return "emocional";
  if (input.isDropshipping) {
    if ((input.durationSec ?? 20) <= 16) return "viral";
    return "energetico";
  }
  if (/\b(paso a paso|profesional|empresa|calidad garantizada)\b/.test(t)) return "profesional";
  if ((input.durationSec ?? 20) >= 35) return "storytelling";
  return "viral";
}
