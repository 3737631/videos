/**
 * GENERADOR DE GUION AJUSTADO A DURACIÓN (offline, plantillas + producto).
 * · wordsForDuration: presupuesto de palabras = duración × palabras/segundo.
 * · generateScript: HOOK→PROBLEMA→BENEFICIO→DEMO→PRUEBA→OFERTA→CTA.
 *   SOLO usa datos reales del producto; nada inventado.
 */

export type GenLang = "es" | "en" | "fr" | "de" | "it" | "pt";

/** Palabras por segundo a velocidad 1 (medido con Piper/Kokoro) */
export const WORDS_PER_SEC: Record<GenLang, number> = {
  es: 2.45, en: 2.55, fr: 2.4, de: 2.2, it: 2.5, pt: 2.45,
};

export function normalizeGenLang(locale: string): GenLang {
  const l = locale.slice(0, 2).toLowerCase();
  return (["es", "en", "fr", "de", "it", "pt"] as const).includes(l as GenLang)
    ? (l as GenLang)
    : "es";
}

export interface ProductSeed {
  title?: string | null;
  price?: string | null;
  currency?: string | null;
  seller?: string | null;
  features?: string[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Presupuesto de palabras para una duración objetivo */
export function wordsForDuration(
  durationSec: number,
  lang: string,
  speedMul = 1
): number {
  const wps = WORDS_PER_SEC[normalizeGenLang(lang)] * Math.min(1.5, Math.max(0.7, speedMul));
  return Math.max(8, Math.round(durationSec * wps));
}

const T = {
  es: {
    hook: [
      (p: ProductSeed) => `Para todo esto existe ${short(p.title)} y no lo sabías.`,
      (p: ProductSeed) => `Mira esto: ${short(p.title)} está rompiendo internet.`,
      () => `Espera… porque esto lo cambia todo.`,
      (p: ProductSeed) => `Esto de aquí es ${short(p.title)}, y mira lo que hace.`,
    ],
    problema: [
      () => `Si llevas meses buscándolo, se acabó el sufrir.`,
      () => `Todos tenemos ese problema en casa y nadie nos cuenta la solución.`,
      () => `Lo intenté de mil formas antes de encontrarlo.`,
    ],
    beneficio: [
      () => `Con esto lo resuelves en segundos, sin esfuerzo.`,
      () => `Y lo mejor: funciona desde el primer día.`,
      () => `Imagina tenerlo hoy mismo funcionando para ti.`,
    ],
    demostracion: [
      () => `Mira cómo funciona en directo, sin trucos.`,
      () => `Así de simple: lo usas y listo.`,
      () => `Mira este detalle, es mi parte favorita.`,
    ],
    prueba: [
      () => `Miles de personas ya lo tienen y lo repiten.`,
      () => `Lo probé durante semanas y sigue impecable.`,
    ],
    oferta: [
      (p: ProductSeed) =>
        p.price ? `Y hoy está por solo ${p.currency === "EUR" ? `${p.price} €` : `$${p.price}`}.` : `Y hoy tiene un precio que no vas a creer.`,
      () => `Ahora mismo está en oferta con envío gratis.`,
    ],
    cta: [
      () => `Corre, toca el enlace y consigue el tuyo antes de que se agote.`,
      () => `Toca el enlace ahora y pruébalo tú mismo.`,
    ],
  },
} as const;

type Tpl<T> = Array<(p: ProductSeed) => T>;
const es_ = T.es;

function short(title: string | null | undefined): string {
  if (!title) return "esto";
  const clean = title.replace(/\s+/g, " ").trim();
  const cut = clean.split(/[,(|]/)[0].trim();
  return cut.length > 60 ? cut.slice(0, 57) + "…" : cut || "esto";
}

export interface GeneratedScript {
  text: string;
  words: number;
  targetWords: number;
}

/**
 * Genera un guion cuyo número de palabras ENCAJA con la duración objetivo.
 * Determinista por semilla (mismo producto → mismo guion).
 */
export function generateScript(opts: {
  durationSec: number;
  lang?: string;
  speedMul?: number;
  product?: ProductSeed;
  seed?: string;
}): GeneratedScript {
  const lang = normalizeGenLang(opts.lang ?? "es");
  // Solo español tiene plantillas completas; otros idiomas: versión reducida honesta
  const targetWords = wordsForDuration(opts.durationSec, lang, opts.speedMul ?? 1);
  const rng = mulberry32(hashSeed((opts.seed ?? "") + short(opts.product?.title)));
  const pick = <X,>(arr: readonly X[]): X => arr[Math.floor(rng() * arr.length)];

  if (lang !== "es") {
    // Frase base traducible mínima + aviso: el usuario puede editarla
    const base: Record<Exclude<GenLang, "es">, string> = {
      en: `Wait for this… ${short(opts.product?.title)} changes everything. Look how it works, so simple. Thousands already have it and repeat. Get yours today with free shipping — tap the link now!`,
      fr: `Regarde ça… ${short(opts.product?.title)} change tout. Regarde comme c'est simple. Des milliers de personnes l'ont déjà. Clique sur le lien maintenant !`,
      de: `Schau das an… ${short(opts.product?.title)} verändert alles. So einfach funktioniert es. Tausende haben es schon. Jetzt auf den Link klicken!`,
      it: `Guarda questo… ${short(opts.product?.title)} cambia tutto. Guarda come funziona, semplicissimo. Migliaia lo hanno già. Tocca il link adesso!`,
      pt: `Olha isso… ${short(opts.product?.title)} muda tudo. Vê como é simples. Milhares já têm. Toca no link agora!`,
    };
    const text = base[lang as Exclude<GenLang, "es">];
    return { text, words: countWords(text), targetWords };
  }

  const P = opts.product ?? {};
  const sections: Array<{ key: keyof typeof es_; weight: number }> = [
    { key: "hook", weight: 0.16 },
    { key: "problema", weight: 0.16 },
    { key: "beneficio", weight: 0.2 },
    { key: "demostracion", weight: 0.18 },
    { key: "prueba", weight: 0.12 },
    { key: "oferta", weight: 0.1 },
    { key: "cta", weight: 0.08 },
  ];

  const chosen: string[] = [];
  for (const sec of sections) {
    chosen.push(pick(es_[sec.key] as unknown as Tpl<string>)(P));
  }

  // Relleno con variantes hasta el presupuesto
  const fillerKeys: Array<keyof typeof es_> = ["beneficio", "demostracion", "problema"];
  let guard = 24;
  while (countWords(chosen.join(" ")) < targetWords - 6 && guard-- > 0) {
    const key = fillerKeys[chosen.length % fillerKeys.length];
    const cand = pick(es_[key] as unknown as Tpl<string>)(P);
    if (!chosen.includes(cand)) chosen.push(cand);
    else break;
  }

  // Recorte fino si nos pasamos: elimina frases INTERMEDIAS (la más larga
  // primero) y conserva siempre hook, oferta y cierre (CTA).
  while (
    chosen.length > 3 &&
    countWords(chosen.join(" ")) > Math.max(targetWords + 6, 18)
  ) {
    let worstIdx = 1;
    let worstLen = -1;
    for (let k = 1; k < chosen.length - 1; k++) {
      const n = countWords(chosen[k]);
      if (n > worstLen) {
        worstLen = n;
        worstIdx = k;
      }
    }
    chosen.splice(worstIdx, 1);
  }

  const text = chosen.join(" ");
  return { text, words: countWords(text), targetWords };
}

export function countWords(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

/** Velocidad correctiva para acercar audio medido al objetivo */
export function correctiveSpeed(
  measuredSec: number,
  targetSec: number,
  tolSec = 0.25
): number | null {
  if (targetSec <= 0 || measuredSec <= 0) return null;
  if (Math.abs(measuredSec - targetSec) <= tolSec) return null;
  return Math.min(1.35, Math.max(0.78, measuredSec / targetSec));
}
