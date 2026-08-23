import type { MusicTrack } from "@/types";

export async function probeAudioMeta(url: string): Promise<{ duration: number }> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      resolve({ duration: isFinite(audio.duration) ? audio.duration : 0 });
    audio.onerror = () => resolve({ duration: 0 });
    audio.src = url;
  });
}

export async function createMusicTrack(file: File): Promise<MusicTrack> {
  const url = URL.createObjectURL(file);
  const { duration } = await probeAudioMeta(url);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ""),
    duration: Math.round(duration * 10) / 10,
    bpm: 0,
    category: "personal",
    url,
  };
}

export const DEMO_MUSIC: MusicTrack[] = [
  {
    id: "demo-upbeat",
    name: "Upbeat energía (demo)",
    duration: 0,
    bpm: 124,
    category: "energética",
    url: "",
  },
  {
    id: "demo-chill",
    name: "Chill suave (demo)",
    duration: 0,
    bpm: 90,
    category: "relajada",
    url: "",
  },
];

export async function generateTone(url: string, frequency = 440, seconds = 2): Promise<string> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = 0;
  ctx.close().catch(() => {});
  return url;
}

// ===== Biblioteca personal PERSISTENTE (antes las subidas se perdían al recargar) =====
const MUSIC_DB = "clipcraft-music-db";

function openMusicDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(MUSIC_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("tracks")) {
          req.result.createObjectStore("tracks", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface StoredTrack extends MusicTrack {
  blob: Blob;
}

export async function saveUserTrack(file: File): Promise<MusicTrack | null> {
  const track = await createMusicTrack(file);
  const db = await openMusicDb();
  if (!db) return track;
  await new Promise<void>((resolve) => {
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put({ ...track, blob: file });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  return track;
}

/** Devuelve las pistas del usuario (la más reciente primero) con URL de objeto viva */
export async function getUserTracks(): Promise<StoredTrack[]> {
  const db = await openMusicDb();
  if (!db) return [];
  const rows = await new Promise<StoredTrack[]>((resolve) => {
    const tx = db.transaction("tracks", "readonly");
    const rq = tx.objectStore("tracks").getAll();
    rq.onsuccess = () => resolve((rq.result as StoredTrack[]) || []);
    rq.onerror = () => resolve([]);
  });
  // La más reciente primero (los ids UUID no ordenan; guardamos orden por índice invertido)
  return rows.reverse().map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }));
}

/**
 * Generador de música ORIGINAL por síntesis (OfflineAudioContext).
 * No depende de descargas ni de bibliotecas externas: la pista se compone
 * matemáticamente en el dispositivo, así que SIEMPRE existe música que mezclar.
 * Estilo: pop viral 122 BPM (kick 4x4, hats, bajo y arpegio sobre Am–F–C–G).
 */
export interface GeneratedMusicTrack extends MusicTrack {
  blob: Blob;
}

function encodeWavStereo(chans: Float32Array[], sampleRate: number): Blob {
  const frames = chans[0].length;
  const nCh = chans.length;
  const data = new Int16Array(frames * nCh);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = chans[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      data[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  const blockAlign = nCh * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(data.buffer));
  return new Blob([buffer], { type: "audio/wav" });
}

// Notas en Hz
const N = {
  A1: 55.0, C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.0,
  A2: 110.0, Bb2: 116.54, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0,
  A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0,
  A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.26, F5: 698.46, G5: 783.99,
};

export type MusicCategory =
  | "viral"
  | "lifestyle"
  | "romantico"
  | "misterioso"
  | "triste"
  | "divertido"
  | "motivacional"
  | "storytelling"
  | "relajado";

interface StylePreset {
  label: string;
  bpm: number;
  /** 4 acordes (compás cada uno), [bajo, voz1, voz2, voz3] */
  chords: number[][];
  arp: number[];
  padType: OscillatorType;
  padVol: number;
  bassType: OscillatorType;
  bassVol: number;
  bassFilterHz: number;
  arpType: OscillatorType;
  arpVol: number;
  arpEverySteps: number; // en corcheas
  kickPattern: number[]; // beats (0-3) con bombo
  hatSteps: number[]; // pasos de corchea (0-7) con hi-hat
  padAttack: number;
}

const STYLES: Record<MusicCategory, StylePreset> = {
  viral: {
    label: "Energético viral",
    bpm: 128,
    chords: [
      [N.A2, N.A3, N.C4, N.E4],
      [N.F3, N.A3, N.C4, N.F4],
      [N.C3, N.G3, N.C4, N.E4],
      [N.G3, N.B3, N.D4, N.G4],
    ],
    arp: [N.A4, N.E5, N.C5, N.E4],
    padType: "triangle",
    padVol: 0.07,
    bassType: "sine",
    bassVol: 0.32,
    bassFilterHz: 700,
    arpType: "square",
    arpVol: 0.05,
    arpEverySteps: 2,
    kickPattern: [0, 1, 2, 3],
    hatSteps: [1, 3, 5, 7],
    padAttack: 0.08,
  },
  lifestyle: {
    label: "Lifestyle",
    bpm: 102,
    chords: [
      [N.C3, N.E4, N.G4, N.C5],
      [N.G3, N.D4, N.G4, N.B4],
      [N.A2, N.C4, N.E4, N.A4],
      [N.F3, N.A3, N.C4, N.F4],
    ],
    arp: [N.G4, N.C5, N.E5, N.G4],
    padType: "triangle",
    padVol: 0.08,
    bassType: "sine",
    bassVol: 0.26,
    bassFilterHz: 600,
    arpType: "sine",
    arpVol: 0.06,
    arpEverySteps: 2,
    kickPattern: [0, 2],
    hatSteps: [2, 6],
    padAttack: 0.12,
  },
  romantico: {
    label: "Romántico",
    bpm: 76,
    chords: [
      [N.F3, N.A3, N.C4, N.F4],
      [N.G3, N.B3, N.D4, N.G4],
      [N.C3, N.E4, N.G4, N.C5],
      [N.A2, N.C4, N.E4, N.A4],
    ],
    arp: [N.C5, N.F5, N.E5, N.C5],
    padType: "sine",
    padVol: 0.10,
    bassType: "sine",
    bassVol: 0.22,
    bassFilterHz: 500,
    arpType: "sine",
    arpVol: 0.05,
    arpEverySteps: 4,
    kickPattern: [0],
    hatSteps: [],
    padAttack: 0.25,
  },
  misterioso: {
    label: "Misterioso",
    bpm: 92,
    chords: [
      [N.D2 * 2, N.A3, N.D4, N.F4],
      [N.Bb2, N.D4, N.F4, N.Bb2 * 4],
      [N.F2 * 2, N.C4, N.F4, N.A4],
      [N.C3, N.G3, N.C4, N.E4],
    ],
    arp: [N.D4, N.F4, N.A4, N.D5],
    padType: "sawtooth",
    padVol: 0.05,
    bassType: "sine",
    bassVol: 0.34,
    bassFilterHz: 400,
    arpType: "triangle",
    arpVol: 0.04,
    arpEverySteps: 4,
    kickPattern: [0, 2],
    hatSteps: [3, 7],
    padAttack: 0.18,
  },
  triste: {
    label: "Triste emotivo",
    bpm: 66,
    chords: [
      [N.A2, N.C4, N.E4, N.A4],
      [N.E2 * 2, N.B3, N.E4, N.G4],
      [N.F2 * 2, N.A3, N.C4, N.F4],
      [N.C3, N.E4, N.G4, N.C5],
    ],
    arp: [N.E4, N.A4, N.C5, N.E5],
    padType: "triangle",
    padVol: 0.09,
    bassType: "sine",
    bassVol: 0.20,
    bassFilterHz: 450,
    arpType: "sine",
    arpVol: 0.04,
    arpEverySteps: 8,
    kickPattern: [],
    hatSteps: [],
    padAttack: 0.35,
  },
  divertido: {
    label: "Divertido",
    bpm: 134,
    chords: [
      [N.C3, N.E4, N.G4, N.C5],
      [N.G2, N.D4, N.G4, N.B4],
      [N.F2 * 2, N.A3, N.C4, N.F4],
      [N.C3, N.E4, N.G4, N.C5],
    ],
    arp: [N.C5, N.E5, N.G5, N.E5],
    padType: "square",
    padVol: 0.045,
    bassType: "triangle",
    bassVol: 0.28,
    bassFilterHz: 800,
    arpType: "square",
    arpVol: 0.055,
    arpEverySteps: 1,
    kickPattern: [0, 1, 2, 3],
    hatSteps: [0, 2, 4, 5, 6, 7],
    padAttack: 0.02,
  },
  motivacional: {
    label: "Motivacional épico",
    bpm: 120,
    chords: [
      [N.G2, N.D4, N.G4, N.B4],
      [N.D2 * 2, N.A3, N.D4, N.F4],
      [N.E2 * 2, N.B3, N.E4, N.G4],
      [N.C3, N.G3, N.C4, N.E4],
    ],
    arp: [N.G4, N.D5, N.G5, N.D5],
    padType: "sawtooth",
    padVol: 0.06,
    bassType: "sine",
    bassVol: 0.36,
    bassFilterHz: 750,
    arpType: "sawtooth",
    arpVol: 0.04,
    arpEverySteps: 2,
    kickPattern: [0, 1, 2, 3],
    hatSteps: [2, 6],
    padAttack: 0.06,
  },
  storytelling: {
    label: "Storytelling cálido",
    bpm: 86,
    chords: [
      [N.F3, N.A3, N.C4, N.E4],
      [N.C3, N.E4, N.G4, N.C5],
      [N.A2, N.C4, N.E4, N.A4],
      [N.G3, N.B3, N.D4, N.G4],
    ],
    arp: [N.A4, N.C5, N.E5, N.C5],
    padType: "triangle",
    padVol: 0.085,
    bassType: "sine",
    bassVol: 0.24,
    bassFilterHz: 550,
    arpType: "sine",
    arpVol: 0.05,
    arpEverySteps: 4,
    kickPattern: [0],
    hatSteps: [4],
    padAttack: 0.2,
  },
  relajado: {
    label: "Relajado ambient",
    bpm: 72,
    chords: [
      [N.A2, N.C4, N.E4, N.G4],
      [N.F2 * 2, N.A3, N.C4, N.E4],
      [N.C3, N.E4, N.G4, N.B4],
      [N.G2, N.B3, N.D4, N.F4],
    ],
    arp: [N.E5, N.A4, N.G4, N.E4],
    padType: "sine",
    padVol: 0.11,
    bassType: "sine",
    bassVol: 0.18,
    bassFilterHz: 420,
    arpType: "sine",
    arpVol: 0.03,
    arpEverySteps: 8,
    kickPattern: [],
    hatSteps: [],
    padAttack: 0.45,
  },
};

const CATEGORY_KEYWORDS: Array<{ cat: MusicCategory; words: string[] }> = [
  {
    cat: "divertido",
    words: ["funny", "gracioso", "divertid", "risa", "reír", "reir", "lol", "meme", "chiste", "cómico", "comico", "broma"],
  },
  {
    cat: "romantico",
    words: ["amor", "love", "romántic", "romantic", "pareja", "novio", "novia", "boda", "wedding", "corazón", "corazon", "crush"],
  },
  {
    cat: "triste",
    words: ["triste", "sad", "llorar", "emotivo", "pérdida", "perdida", "adiós", "adios", "nostalgia", "extrañar", "heartbreak", "despedida"],
  },
  {
    cat: "misterioso",
    words: ["misterio", "mystery", "secreto", "secret", "oculto", "nadie sabe", "escalofriante", "creepy", "enigma", "oscuro"],
  },
  {
    cat: "motivacional",
    words: ["motiva", "éxito", "exito", "success", "ganar", "win", "logro", "superar", "disciplina", "hustle", "grind", "sueño", "sueno", "dream", "mindset", "esfuerzo"],
  },
  {
    cat: "relajado",
    words: ["relaj", "calma", "chill", "asmr", "spa", "tranquil", "zen", "descanso", "sleep", "dormir", "satisfying"],
  },
  {
    cat: "storytelling",
    words: ["historia", "story", "un día", "un dia", "one day", "resulta que", "resultó", "resulto", "cuénta", "cuenta qué", "pasó que", "thread", "sabías", "sabias"],
  },
  {
    cat: "lifestyle",
    words: ["rutina", "routine", "day in my life", "vlog", "lifestyle", "outfit", "skincare", "café", "cafe", "morning", "hogar", "decor", "viaje", "travel", "playa"],
  },
];

/** Elige la categoría musical automáticamente según el tono del guion y del proyecto */
export function pickMusicCategory(
  scriptText: string,
  projectStyle?: string,
  goal?: string
): MusicCategory {
  const hay = `${scriptText} ${projectStyle || ""} ${goal || ""}`.toLowerCase();
  let bestCat: MusicCategory = "viral";
  let bestScore = 0;
  for (const { cat, words } of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += w.length > 5 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  // Sin señales claras: estilo declarado del proyecto como pista secundaria
  if (bestScore === 0) {
    const s = `${projectStyle || ""} ${goal || ""}`.toLowerCase();
    if (/lujo|premium|elegan/.test(s)) return "lifestyle";
    if (/educativ|tutorial|tip|consejo/.test(s)) return "storytelling";
    if (/deport|fitness|gym|acción|accion/.test(s)) return "motivacional";
  }
  return bestCat;
}

export async function generateMusicTrack(
  seconds: number,
  category: MusicCategory = "viral"
): Promise<GeneratedMusicTrack> {
  const S = STYLES[category] || STYLES.viral;
  const dur = Math.max(8, Math.min(45, seconds + 1));
  const sr = 44100;
  const OC: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const ctx = new OC(2, Math.ceil(dur * sr), sr);

  const bpm = S.bpm;
  const beat = 60 / bpm;
  const bar = beat * 4;

  // Master con compresión suave para que no sature
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp);
  comp.connect(ctx.destination);

  const tone = (
    freq: number,
    t0: number,
    len: number,
    type: OscillatorType,
    vol: number,
    attack = 0.005,
    filterHz?: number
  ) => {
    if (!isFinite(freq) || freq <= 0) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.25), t0 + len);
    g.gain.linearRampToValueAtTime(0.0001, t0 + len + 0.03);
    let out: AudioNode = g;
    if (filterHz) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filterHz;
      g.connect(f);
      out = f;
    }
    osc.connect(g);
    out.connect(master);
    osc.start(t0);
    osc.stop(t0 + len + 0.06);
  };

  const kick = (t0: number) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  };

  const hat = (t0: number) => {
    const len = 0.05;
    const buf = ctx.createBuffer(1, Math.ceil(len * sr), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  };

  const bars = Math.ceil(dur / bar);
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    if (t0 > dur) break;
    const chord = S.chords[b % 4];
    // Pad (acorde sostenido)
    for (const fq of chord.slice(1)) tone(fq, t0, bar * 0.95, S.padType, S.padVol, S.padAttack, 2200);
    // Bajo a negras
    for (let bt = 0; bt < 4; bt++) tone(chord[0], t0 + bt * beat, beat * 0.85, S.bassType, S.bassVol, 0.004, S.bassFilterHz);
    // Arpegio
    for (let st = 0; st < 8; st += S.arpEverySteps) {
      tone(S.arp[(b + st) % S.arp.length], t0 + st * (beat / 2), beat * 0.42, S.arpType, S.arpVol, 0.003, 5200);
    }
    // Batería según patrón del estilo
    for (const bt of S.kickPattern) kick(t0 + bt * beat);
    for (const st of S.hatSteps) hat(t0 + st * (beat / 2));
  }

  const rendered = await ctx.startRendering();
  const L = rendered.getChannelData(0);
  const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
  // Verificación interna: la pista DEBE contener energía real
  let peak = 0;
  for (let i = 0; i < L.length; i += 31) peak = Math.max(peak, Math.abs(L[i]));
  if (peak < 0.01) throw new Error("La pista musical generada está vacía");
  const blob = encodeWavStereo([L, R], sr);
  const url = URL.createObjectURL(blob);
  return {
    id: `auto-${category}-${Date.now().toString(36)}`,
    name: `${S.label} (automática)`,
    duration: rendered.duration,
    bpm,
    category,
    url,
    blob,
  };
}
