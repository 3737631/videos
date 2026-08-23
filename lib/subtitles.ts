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
 * Construye las tarjetas de subtítulo.
 * · Con `segTimings` (timestamps REALES por frase, medidos del audio):
 *   cada grupo de tarjetas se recorta dentro de SU ventana real.
 * · Sin ellos: reparto proporcional sobre la duración total (fallback).
 */
export function buildSubtitles(
  scriptText: string,
  voiceDuration: number | null,
  opts: {
    charsPerLine?: number;
    niche?: Niche;
    segTimings?: Array<{ text: string; start: number; end: number }>;
  } = {}
): BuiltSubtitles {
  const style = styleForNiche(opts.niche || "generico");
  if (!voiceDuration || voiceDuration <= 0.3) return { cues: [], style };

  const segs =
    opts.segTimings && opts.segTimings.length
      ? mergeSegments(scriptText, opts.segTimings)
      : null;
  if (segs) {
    const cues: SubtitleCue[] = [];
    for (const seg of segs) {
      cues.push(...cuesForWindow(seg.text, seg.start, seg.end, opts.charsPerLine ?? 24));
    }
    return { cues, style };
  }
  return { cues: cuesProportional(scriptText, voiceDuration, opts.charsPerLine ?? 24), style };
}

/** Une timings con el guion real (recorte/edición del usuario) por prefijo */
function mergeSegments(
  scriptText: string,
  timings: Array<{ text: string; start: number; end: number }>
): Array<{ text: string; start: number; end: number }> {
  const scriptWords = scriptText.replace(/\s+/g, " ").trim().split(" ");
  let cursor = 0;
  const out: Array<{ text: string; start: number; end: number }> = [];
  for (const t of timings) {
    const n = t.text.split(/\s+/).filter(Boolean).length;
    const slice = scriptWords.slice(cursor, cursor + n).join(" ");
    cursor += n;
    out.push({ text: slice || t.text, start: t.start, end: t.end });
    if (cursor >= scriptWords.length) break;
  }
  // Palabras restantes tras edición → añádelas al último segmento
  if (cursor < scriptWords.length && out.length) {
    out[out.length - 1].text += " " + scriptWords.slice(cursor).join(" ");
  }
  return out;
}

/** Tarjetas dentro de una ventana REAL [start,end] (máx. 2 líneas + resaltado) */
function cuesForWindow(
  text: string,
  winStart: number,
  winEnd: number,
  charsPerLine: number
): SubtitleCue[] {
  const words: WordItem[] = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => ({ word: w, weight: Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length || 2) }));
  if (!words.length) return [];

  const span = Math.max(0.4, winEnd - winStart);
  const totalWeight = words.reduce((a, w) => a + w.weight, 0);
  const groups: WordItem[][] = [];
  let i = 0;
  while (i < words.length) {
    const group: WordItem[] = [];
    let lines = 1;
    let lineLen = 0;
    while (i < words.length) {
      const w = words[i];
      const addLen = lineLen === 0 ? w.word.length : lineLen + 1 + w.word.length;
      if (addLen > charsPerLine) {
        if (lines >= 2) break;
        lines++;
        lineLen = w.word.length;
      } else lineLen = addLen;
      group.push(w);
      i++;
      if (/[.!?…]$/.test(w.word)) break;
    }
    if (!group.length) break;
    groups.push(group);
  }

  let emojisUsedGlobal = 0;
  const cues: SubtitleCue[] = [];
  let t = winStart;
  for (const group of groups) {
    const gWeight = group.reduce((a, w) => a + w.weight, 0);
    const dur = Math.max(0.45, (gWeight / totalWeight) * span);
    const start = t;
    const end = Math.min(winEnd, start + dur);
    t = end;

    let wt = start;
    const wts = group.map((w) => {
      const d = (w.weight / gWeight) * dur;
      const item = { word: w.word, start: wt, end: wt + d };
      wt += d;
      return item;
    });

    const lineLen = group.reduce((a, w) => a + w.word.length + 1, 0);
    let text: string;
    if (group.length > 2 && lineLen > charsPerLine) {
      let acc = 0;
      let splitAt = 1;
      for (let k = 0; k < group.length; k++) {
        acc += group[k].word.length + 1;
        if (acc >= lineLen / 2) {
          splitAt = k + 1;
          break;
        }
      }
      splitAt = Math.min(group.length - 1, Math.max(1, splitAt));
      text =
        group.slice(0, splitAt).map((w) => w.word).join(" ") +
        "\n" +
        group.slice(splitAt).map((w) => w.word).join(" ");
    } else text = group.map((w) => w.word).join(" ");

    const emoji = pickEmoji(text, emojisUsedGlobal);
    if (emoji) {
      emojisUsedGlobal++;
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
  return cues;
}

/** Fallback original: proporcional sobre toda la voz */
function cuesProportional(
  scriptText: string,
  voiceDuration: number,
  charsPerLine: number
): SubtitleCue[] {
  return cuesForWindow(
    scriptText,
    Math.min(0.15, voiceDuration * 0.02),
    voiceDuration * 0.995,
    charsPerLine
  );
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
