/**
 * Selector de pista: weighted-random con semilla del proyecto + historial
 * anti-repetición (nunca repetir las últimas 10 pistas usadas).
 */
import { buildLibrary, type MusicCategory, type TrackDef } from "./musicLibrary";

const HISTORY_KEY = "clipcraft-music-history";
const HISTORY_MAX = 10;

export interface MusicSelection {
  track: TrackDef;
  reasonPrimary: MusicCategory;
  reasonSecondary: MusicCategory;
  avoidedRecent: number;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

/** Solo para tests */
export function loadHistoryForTest(): string[] {
  return loadHistory();
}

function saveHistory(ids: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(ids.slice(-20)));
  } catch {}
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Elige una pista compatible con primary/secondary evitando el historial.
 * Núcleo PURO (testeable): recibe historial y RNG; el envoltorio añade
 * persistencia local y semilla del proyecto.
 */
export function pickTrackPure(
  primary: MusicCategory,
  secondary: MusicCategory,
  seed: number,
  recent: Set<string>,
  /** Orden histórico (más antiguo primero); habilita LRU si todo está usado */
  recentOrder: string[] = []
): { track: TrackDef; avoidedRecent: number } {
  const lib = buildLibrary();
  const weighted: Array<{ t: TrackDef; w: number }> = [];
  for (const t of lib) {
    if (t.category === primary) weighted.push({ t, w: recent.has(t.id) ? 1 : 10 });
    else if (t.category === secondary) weighted.push({ t, w: recent.has(t.id) ? 1 : 5 });
  }
  let avoided = 0;
  for (const item of weighted) if (recent.has(item.t.id)) avoided++;

  const fresh = weighted.filter((x) => !recent.has(x.t.id));
  if (fresh.length === 0 && recentOrder.length > 0) {
    // Ventana agotada: LRU global — la usada hace más tiempo (cicla sin repetir)
    let oldest: TrackDef | null = null;
    let oldestIdx = Infinity;
    for (const item of weighted) {
      const idx = recentOrder.lastIndexOf(item.t.id);
      if (idx !== -1 && idx < oldestIdx) {
        oldestIdx = idx;
        oldest = item.t;
      }
    }
    return { track: oldest ?? weighted[weighted.length - 1].t, avoidedRecent: avoided };
  }
  // Mientras haya pistas frescas, el sorteo SOLO considera frescas
  const pool = fresh.length > 0 ? fresh : weighted;

  const rnd = mulberry32(seed);
  const totalW = pool.reduce((a, x) => a + x.w, 0);
  let roll = rnd() * totalW;
  let chosen = pool[pool.length - 1].t;
  for (const x of pool) {
    roll -= x.w;
    if (roll <= 0) {
      chosen = x.t;
      break;
    }
  }
  return { track: chosen, avoidedRecent: avoided };
}

/**
 * Elige una pista compatible con primary/secondary evitando el historial.
 * La semilla combina el proyecto (estable) con un contador global, de modo que
 * dos vídeos distintos casi nunca comparten pista aunque sean de la categoría.
 */
export function selectTrack(
  primary: MusicCategory,
  secondary: MusicCategory,
  projectId: string,
  timestampMs = Date.now()
): MusicSelection {
  const hist = loadHistory();
  const { track, avoidedRecent } = pickTrackPure(
    primary,
    secondary,
    hashStr(projectId) ^ timestampMs,
    new Set(hist),
    hist
  );
  hist.push(track.id);
  while (hist.length > HISTORY_MAX) hist.shift();
  saveHistory(hist);
  return {
    track,
    reasonPrimary: primary,
    reasonSecondary: secondary,
    avoidedRecent,
  };
}
