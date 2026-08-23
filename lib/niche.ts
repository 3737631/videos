/**
 * MODO DROPSHIPPING V3 — detección automática del nicho del guion y
 * ajustes derivados (música, velocidad de locución, paleta, CTA).
 */

export type Niche =
  | "tiktokshop"
  | "belleza"
  | "hogar"
  | "fitness"
  | "cocina"
  | "gadget"
  | "generico";

const KEYWORDS: Array<[Niche, string[]]> = [
  ["tiktokshop", ["tiktok shop", "dropshipping", "producto viral", "tienda online", "envío gratis", "link de la bio", "link en la bio", "tiktok shop finds"]],
  ["belleza", ["skincare", "rutina facial", "crema", "serum", "sérum", "maquillaje", "peinado", "uñas", "belleza", "acne", "acné", "beauty", "glow"]],
  ["hogar", ["hogar", "casa", "organizador", "limpieza", "decoración", "decoracion", "almohada", "lámpara", "lampara", "armario", "home"]],
  ["fitness", ["gym", "fitness", "abdomen", "entrenar", "entrenamiento", "músculo", "musculo", "pesas", "yoga", "cinta de correr", "workout"]],
  ["cocina", ["cocina", "receta", "freidora", "air fryer", "batidora", "cafetera", "cuchillo", "sartén", "sarten", "kitchen", "utensilio"]],
  ["gadget", ["gadget", "cargador", "auriculares", "smartwatch", "reloj inteligente", "powerbank", "tech", "gizmo", "truco tecnológico"]],
];

export interface NicheInfo {
  niche: Niche;
  isDropshipping: boolean;
  matched: string[];
}

export function detectNiche(scriptText: string): NicheInfo {
  const t = scriptText.toLowerCase();
  const matched = new Set<string>();
  let best: Niche = "generico";
  let bestScore = 0;
  const scores = new Map<Niche, number>();
  for (const [niche, words] of KEYWORDS) {
    let score = 0;
    for (const w of words) {
      if (t.includes(w)) {
        score += w.includes(" ") ? 2 : 1;
        matched.add(w);
      }
    }
    scores.set(niche, score);
    if (score > bestScore) {
      bestScore = score;
      best = niche;
    }
  }
  const isShop = (scores.get("tiktokshop") || 0) > 0 || /compra ahora|cómpralo|compralo|oferta limitada|solo hoy|precio especial/.test(t);
  return {
    niche: best,
    isDropshipping: isShop || bestScore >= 2,
    matched: [...matched],
  };
}

export interface NichePalette {
  activeColor: string;
  accent: string;
}

export const NICHE_PALETTES: Record<Niche, NichePalette> = {
  tiktokshop: { activeColor: "#25F4EE", accent: "#FE2C55" }, // TikTok
  belleza: { activeColor: "#FF6FB5", accent: "#FFB86B" },
  hogar: { activeColor: "#7CFCB1", accent: "#FFD166" },
  fitness: { activeColor: "#FF4E45", accent: "#FFD166" },
  cocina: { activeColor: "#FFA53B", accent: "#FFE066" },
  gadget: { activeColor: "#4CC9FF", accent: "#B388FF" },
  generico: { activeColor: "#8B7CFF", accent: "#22D3EE" },
};

/** Velocidad de locución sugerida (dropshipping = ritmo más ágil) */
export function suggestedSpeechRate(info: NicheInfo): number {
  return info.isDropshipping ? 1.08 : 1;
}

/** CTA final sugerido para cerrar el vídeo */
export function suggestedCTA(info: NicheInfo, langPrefix = "es"): string {
  if (!langPrefix.startsWith("es")) return "";
  if (!info.isDropshipping) return "";
  const options = [
    "¡Enlace en la bio antes de que se agote!",
    "Compra ahora con envío gratis.",
    "Toca el enlace y consigue el tuyo hoy.",
  ];
  const idx = Math.abs(hashStr(info.niche)) % options.length;
  return options[idx];
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
