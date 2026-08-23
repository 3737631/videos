/**
 * SUBTÍTULOS ESTILO TIKTOK/CAPCUT V3
 * · Máx. 2 líneas por tarjeta, tamaño adaptativo
 * · Palabras importantes RESALTADAS (números, precios, MAYÚSCULAS, ganchos)
 * · Animación "pop" y colores dinámicos según el nicho
 * · Sin voz NO hay subtítulos (modo solo-música = cero texto en pantalla)
 */
import type { SubtitleCue, SubtitleStyle } from "@/types";
import { NICHE_PALETTES, type Niche } from "@/lib/niche";

const HIGHLIGHT_WORDS = new Set([
  "gratis", "free", "oferta", "ofertas", "descuento", "hoy", "ahora", "nuevo", "nueva",
  "increíble", "increible", "viral", "bestseller", "top", "precio", "solo", "última",
  "ultima", "rebajas", "rebaja", "chollo", "gangа", "bomba", "wow", "stop", "mira",
]);

const EMOJI_TRIGGERS: Array<[RegExp, string]> = [
  [/gratis|free/i, "🎁"],
  [/oferta|descuento|rebaja/i, "🏷️"],
  [/sorpresa|increíble|increible|wow/i, "😲"],
  [/fuego|hot/i, "🔥"],
  [/amor/i, "❤️"],
];

export interface BuiltSubtitles {
  cues: SubtitleCue[];
  style: SubtitleStyle;
}

interface WordItem {
  word: string;
  weight: number;
}

function isHighlight(w: string): boolean {
  const clean = w.replace(/[^\p{L}\p{N}%$€.,]/gu, "");
  if (!clean) return false;
  if (/\d/.test(clean)) return true;
  if (/[$€%]/.test(clean)) return true;
  if (clean.length >= 3 && clean === clean.toUpperCase() && /\p{L}/u.test(clean)) return true;
  return HIGHLIGHT_WORDS.has(clean.toLowerCase());
}

function pickEmoji(text: string, used: number): string | null {
  if (used >= 3) return null;
  for (const [re, emo] of EMOJI_TRIGGERS) if (re.test(text)) return emo;
  return null;
}

/**
 * Construye las tarjetas de subtítulo repartiendo la duración real de la voz
 * proporcionalmente al peso (longitud) de cada palabra.
 */
export function buildSubtitles(
  scriptText: string,
  voiceDuration: number | null,
  opts: { charsPerLine?: number; niche?: Niche } = {}
): BuiltSubtitles {
  const style = styleForNiche(opts.niche || "generico");
  if (!voiceDuration || voiceDuration <= 0.3) return { cues: [], style };

  const charsPerLine = opts.charsPerLine ?? 24;
  const words: WordItem[] = scriptText
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => ({ word: w, weight: Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length || 2) }));
  if (!words.length) return { cues: [], style };

  const speechSpan = voiceDuration * 0.97;
  const totalWeight = words.reduce((a, w) => a + w.weight, 0);
  let t = Math.min(0.15, voiceDuration * 0.02);

  const cues: SubtitleCue[] = [];
  let emojisUsed = 0;
  let i = 0;

  while (i < words.length) {
    const group: WordItem[] = [];
    let lines = 1;
    let lineLen = 0;
    while (i < words.length) {
      const w = words[i];
      const addLen = (lineLen === 0 ? w.word.length : lineLen + 1 + w.word.length);
      const wouldWrap = addLen > charsPerLine;
      if (wouldWrap) {
        if (lines >= 2) break;
        lines++;
        lineLen = w.word.length;
      } else {
        lineLen = addLen;
      }
      group.push(w);
      i++;
      // cortes naturales suaves
      if (/[.!?…]$/.test(w.word)) break;
    }
    if (!group.length) break;

    const gWeight = group.reduce((a, w) => a + w.weight, 0);
    const dur = Math.max(0.5, (gWeight / totalWeight) * speechSpan);
    const start = t;
    const end = Math.min(voiceDuration - 0.05, start + dur);
    t = end;

    // Reparto interno de tiempos por palabra
    let wt = start;
    const wts = group.map((w) => {
      const d = (w.weight / gWeight) * dur;
      const item = { word: w.word, start: wt, end: wt + d };
      wt += d;
      return item;
    });

    // Dos líneas equilibradas
    let text: string;
    if (lines >= 2) {
      let acc = 0;
      let splitAt = 0;
      for (let k = 0; k < group.length; k++) {
        acc += group[k].word.length + 1;
        if (acc >= (lineLen || 1) / 2) {
          splitAt = k + 1;
          break;
        }
      }
      splitAt = Math.min(group.length - 1, Math.max(1, splitAt));
      text =
        group.slice(0, splitAt).map((w) => w.word).join(" ") +
        "\n" +
        group.slice(splitAt).map((w) => w.word).join(" ");
    } else {
      text = group.map((w) => w.word).join(" ");
    }

    const emoji = pickEmoji(text, emojisUsed);
    if (emoji) {
      emojisUsed++;
      text += ` ${emoji}`;
    }

    cues.push({
      start,
      end,
      text,
      words: wts,
      highlight: group.map((w) => isHighlight(w.word)),
    });
  }
  return { cues, style };
}

export function styleForNiche(niche: Niche): SubtitleStyle {
  const pal = NICHE_PALETTES[niche];
  return {
    font: "800 64px Inter, system-ui, sans-serif",
    size: 64,
    weight: 800,
    color: "#FFFFFF",
    activeColor: pal.activeColor,
    shadow: true,
    stroke: true,
    strokeColor: "#000000",
    position: "bottom",
    maxWidth: 0.86,
    animation: "pop",
  };
}
