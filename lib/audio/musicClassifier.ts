/**
 * Clasificador musical por SCORING (no simple búsqueda de palabras).
 * Analiza guion + contexto y devuelve categoría principal, secundaria,
 * energía objetivo, rango de BPM recomendado y confianza.
 */
import type { MusicCategory } from "./musicLibrary";

export interface MusicClassification {
  primaryCategory: MusicCategory;
  secondaryCategory: MusicCategory;
  energy: number; // 0..1
  bpmRange: [number, number];
  confidence: number; // 0..1
}

type Lang = "es" | "en";

interface FeatureWeights {
  words: Array<[string, number]>;
  exclaim?: number;
  question?: number;
  listMarkers?: number; // "3 cosas", "top 5", "nunca"
  caps?: number;
  paceFast?: number;
  paceSlow?: number;
}

const W: Record<MusicCategory, FeatureWeights> = {
  viral: {
    words: [["nadie te cuenta",3],["increíble",2],["incredible",2],["hack",3],["truco",3],["trick",3],["segundos",1],["wait for it",3],["espera al final",3],["viral",3],["trend",2],["tendencia",2],["revelo",2],["reveal",2],["paso a paso",2],["step by step",2]],
    listMarkers: 2, exclaim: 1.5,
  },
  lifestyle: {
    words: [["rutina",4],["routine",4],["morning",2],["mañana",2],["manana",2],["vlog",4],["day in my life",5],["outfit",3],["skincare",3],["café",2],["coffee",2],["hogar",2],["decor",3],["viaje",2],["travel",3],["playa",2],["beach",2],["unboxing",3],["haul",3],["receta",3],["recipe",3],["limpieza",3],["cleaning",3]],
    paceSlow: 1,
  },
  romantic: {
    words: [["amor",4],["love",4],["novia",4],["novio",4],["girlfriend",4],["boyfriend",4],["boda",4],["wedding",4],["corazón",3],["heart",2],["crush",3],["besa",3],["kiss",3],["aniversario",4],["cita",3],["date",2],["romántic",3],["romantic",3]],
    paceSlow: 1.5,
  },
  mysterious: {
    words: [["misterio",4],["mystery",4],["secreto",3],["secret",3],["nadie sabe",4],["nobody knows",4],["oculto",3],["hidden",3],["escalofriante",4],["creepy",4],["enigma",3],["desapareció",4],["disappeared",4],["teoría",2],["theory",2],["oscuro",2],["dark",2]],
    question: 1.5,
  },
  sad: {
    words: [["triste",4],["sad",4],["llorar",3],["cry",2],["emotiv",3],["emotional",2],["pérdida",4],["loss",3],["adiós",3],["goodbye",3],["nostalgia",3],["extrañar",3],["miss you",3],["heartbreak",4],["sola",2],["alone",2],["lágrimas",3],["tears",3]],
    paceSlow: 2,
  },
  funny: {
    words: [["gracioso",4],["funny",4],["divertid",4],["risa",3],["laugh",3],["lol",3],["meme",4],["chiste",4],["joke",4],["cómico",3],["comedy",3],["broma",3],["prank",4],["absurdo",3],["ridícul",3],["fail",3]],
    exclaim: 2,
  },
  motivational: {
    words: [["motiva",4],["motivat",4],["éxito",3],["exito",3],["success",3],["ganar",3],["win",2],["dinero",2],["money",2],["logro",3],["superar",4],["disciplina",4],["discipline",4],["hustle",4],["grind",4],["sueño",3],["dream",2],["mindset",4],["negocio",3],["business",2],["emprender",4],["entrepren",4],["gym",2],["fitness",3],["entrenar",3],["workout",3]],
    listMarkers: 1.5, exclaim: 1,
  },
  storytelling: {
    words: [["historia",4],["story",3],["un día",4],["one day",4],["resulta que",4],["resultó",3],["turns out",4],["cuando era",3],["when i was",3],["jamás imaginé",5],["never imagined",5],["pasó que",4],["sabías que",3],["did you know",3],["thread",3],["capítulo",3],["parte 1",3],["storytime",5]],
  },
  relaxing: {
    words: [["relaj",4],["relax",4],["calma",4],["chill",3],["asmr",5],["spa",4],["tranquil",4],["zen",4],["medita",4],["meditation",4],["respir",3],["breath",2],["dormir",4],["sleep",4],["satisfying",4],["yoga",4]],
    paceSlow: 2.5,
  },
  dramatic: {
    words: [["urgente",3],["urgent",3],["alerta",3],["warning",3],["peligro",4],["danger",4],["última hora",4],["breaking",3],["impacto",3],["shocking",4],["impactante",4],["escándalo",4],["scandal",4],["guerra",3],["war",3],["juicio",3],["trial",2],["verdad",3],["truth",2]],
    exclaim: 2,
  },
};

function countMatches(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

function detectLang(text: string): Lang {
  const t = text.toLowerCase();
  const esHits = [" el ", " la ", " los ", " las ", " que ", " de ", " y ", " para ", " con ", " una ", "por"].filter((w) => t.includes(w)).length;
  const enHits = [" the ", " and ", " you ", " for ", " with ", " this ", " that ", " your ", " are "].filter((w) => t.includes(w)).length;
  return enHits > esHits ? "en" : "es";
}

export function classifyMusic(input: {
  scriptText: string;
  projectStyle?: string;
  goal?: string;
  durationSec?: number;
}): MusicClassification {
  const raw = `${input.scriptText || ""} ${input.projectStyle || ""} ${input.goal || ""}`;
  const text = raw.toLowerCase();
  const lang = detectLang(raw);

  // Features cuantitativas
  const exclam = (raw.match(/!/g) || []).length;
  const question = (raw.match(/[?¿]/g) || []).length;
  const listMarkers = countMatches(text, /\b\d+\s+(cosas|tips|formas|razones|things|ways|reasons|tips)/.source.replace(/\\/g, ""))
    + (/\b(top|mejores|best)\s+\d+/.test(text) ? 1 : 0)
    + (/\b\d+\s+(pasos|steps|hacks)\b/.test(text) ? 1 : 0);
  const letters = raw.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const uppers = raw.replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
  const caps = letters.length ? uppers.length / letters.length : 0;
  const sentences = input.scriptText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgLen = sentences.length
    ? sentences.reduce((a, s) => a + s.trim().split(/\s+/).length, 0) / sentences.length
    : 12;

  const scores: Record<MusicCategory, number> = {} as Record<MusicCategory, number>;
  let maxPossible = 0;
  (Object.keys(W) as MusicCategory[]).forEach((cat) => {
    let s = 0;
    const fw = W[cat];
    for (const [w, weight] of fw.words) {
      const hits = countMatches(text, w.toLowerCase());
      s += Math.min(hits, 3) * weight;
      maxPossible += weight * 3;
    }
    if (fw.exclaim && exclam) s += Math.min(exclam, 3) * fw.exclaim;
    if (fw.question && question) s += Math.min(question, 3) * fw.question;
    if (fw.listMarkers && listMarkers) s += listMarkers * fw.listMarkers;
    if (fw.caps && caps > 0.15) s += fw.caps * Math.min((caps - 0.1) * 10, 3);
    if (fw.paceFast && avgLen < 8) s += fw.paceFast * ((8 - avgLen) / 4);
    if (fw.paceSlow && avgLen > 14) s += fw.paceSlow * Math.min((avgLen - 14) / 6, 2);
    scores[cat] = s;
  });

  const ranked = (Object.keys(scores) as MusicCategory[]).sort((a, b) => scores[b] - scores[a]);
  const primary = ranked[0];
  const secondary = ranked[1];
  const topScore = scores[primary];
  const runnerScore = scores[secondary];
  const confidence =
    maxPossible === 0 ? 0.25 : Math.max(0.2, Math.min(0.95, (topScore - runnerScore * 0.6) / (topScore + 12)));

  const energyBase: Record<MusicCategory, number> = {
    viral: 0.9, lifestyle: 0.55, romantic: 0.3, mysterious: 0.45, sad: 0.18,
    funny: 0.95, motivational: 0.85, storytelling: 0.4, relaxing: 0.15, dramatic: 0.75,
  };
  const bpmBase: Record<MusicCategory, [number, number]> = {
    viral: [120, 138], lifestyle: [96, 112], romantic: [70, 84], mysterious: [84, 96],
    sad: [60, 72], funny: [126, 142], motivational: [116, 128], storytelling: [80, 92],
    relaxing: [64, 76], dramatic: [90, 104],
  };

  // Vídeos muy cortos → algo más directo; largos → menos denso
  let energy = energyBase[primary];
  if (input.durationSec && input.durationSec < 12) energy = Math.min(1, energy + 0.08);
  if (input.durationSec && input.durationSec > 30) energy = Math.max(0.1, energy - 0.06);

  return {
    primaryCategory: primary,
    secondaryCategory: secondary,
    energy: Number(energy.toFixed(2)),
    bpmRange: bpmBase[primary],
    confidence: Number(confidence.toFixed(2)),
  };
}
