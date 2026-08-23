/**
 * BIBLIOTECA MUSICAL PROCEDURAL — 10 categorías × 10 pistas = 100 pistas
 * originales royalty-free. Cada pista se DEFINE por su semilla y se sintetiza
 * bajo demanda en el dispositivo (OfflineAudioContext): variaciones reales de
 * BPM, progresión, patrón rítmico, instrumentación, estructura y energía.
 */

export type MusicCategory =
  | "viral"
  | "lifestyle"
  | "romantic"
  | "mysterious"
  | "sad"
  | "funny"
  | "motivational"
  | "storytelling"
  | "relaxing"
  | "dramatic";

export interface TrackDef {
  id: string;
  category: MusicCategory;
  index: number; // 1..10 dentro de su categoría
  seed: number;
}

export const MUSIC_CATEGORIES: MusicCategory[] = [
  "viral", "lifestyle", "romantic", "mysterious", "sad",
  "funny", "motivational", "storytelling", "relaxing", "dramatic",
];

/** PRNG determinista */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Genera las 100 definiciones (determinista, sin estado) */
export function buildLibrary(): TrackDef[] {
  const out: TrackDef[] = [];
  for (const cat of MUSIC_CATEGORIES) {
    for (let i = 1; i <= 10; i++) {
      out.push({
        id: `${cat}_${String(i).padStart(2, "0")}`,
        category: cat,
        index: i,
        seed: hashStr(`clipcraft::${cat}::${i}::v3`),
      });
    }
  }
  return out;
}

// ===== Perfil sonoro por categoría =====
interface CategoryProfile {
  bpmMin: number;
  bpmMax: number;
  /** Progresiones en semitonos desde la tónica (modo menor salvo indicación) */
  progressions: number[][];
  roots: number[]; // frecuencias base candidatas (Hz)
  kickPatterns: number[][]; // posiciones en corcheas (0..7)
  hatDensities: number[][]; // corcheas con hi-hat
  claps: number[][]; // corcheas con palmada/snare
  padWaves: OscillatorType[];
  leadWaves: OscillatorType[];
  bassOctaveProb: number; // probabilidad de bajo alternando octava
  arpRate: number; // corcheas entre notas de arpegio
  swing: number; // retardo de contratiempos (fracción de corchea)
  energyCurve: "flat" | "build" | "drop" | "wave";
  padVol: number;
  bassVol: number;
  leadVol: number;
  drumVol: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const PROFILES: Record<MusicCategory, CategoryProfile> = {
  viral: { bpmMin: 120, bpmMax: 138, roots: [220, 233.08, 261.63], progressions: [[0,8,3,10],[0,5,8,10],[0,3,8,7],[0,10,8,5],[0,8,5,7]], kickPatterns: [[0,2,4,6],[0,3,4,7],[0,2,4,5,6]], hatDensities: [[1,3,5,7],[0,1,2,3,4,5,6,7]], claps: [[2,6]], padWaves:["triangle","sawtooth"], leadWaves:["square","sawtooth"], bassOctaveProb:.55, arpRate:1, swing:.12, energyCurve:"build", padVol:.06, bassVol:.30, leadVol:.05, drumVol:.85 },
  lifestyle: { bpmMin: 96, bpmMax: 112, roots: [196, 220, 246.94], progressions: [[0,7,9,5],[0,5,7,9],[0,9,5,7]], kickPatterns: [[0,4],[0,4,6]], hatDensities: [[2,6],[2,4,6]], claps: [[4]], padWaves:["triangle"], leadWaves:["sine","triangle"], bassOctaveProb:.25, arpRate:2, swing:.18, energyCurve:"flat", padVol:.08, bassVol:.24, leadVol:.06, drumVol:.7 },
  romantic: { bpmMin: 70, bpmMax: 84, roots: [174.61, 196, 220], progressions: [[0,5,8,10],[0,7,5,10],[0,3,8,5]], kickPatterns: [[0]], hatDensities: [[]], claps: [[]], padWaves:["sine"], leadWaves:["sine"], bassOctaveProb:0, arpRate:4, swing:.1, energyCurve:"flat", padVol:.11, bassVol:.20, leadVol:.05, drumVol:.5 },
  mysterious: { bpmMin: 84, bpmMax: 96, roots: [146.83, 164.81, 155.56], progressions: [[0,3,5,7],[0,6,3,5],[0,5,3,7]], kickPatterns: [[0,4],[0,3]], hatDensities: [[3,7],[3]], claps: [[]], padWaves:["sawtooth","triangle"], leadWaves:["triangle"], bassOctaveProb:.35, arpRate:4, swing:.06, energyCurve:"drop", padVol:.06, bassVol:.32, leadVol:.04, drumVol:.65 },
  sad: { bpmMin: 60, bpmMax: 72, roots: [130.81, 146.83, 164.81], progressions: [[0,8,5,10],[0,7,8,5],[0,10,5,8]], kickPatterns: [[]], hatDensities: [[]], claps: [[]], padWaves:["triangle","sine"], leadWaves:["sine"], bassOctaveProb:0, arpRate:8, swing:.08, energyCurve:"flat", padVol:.10, bassVol:.18, leadVol:.04, drumVol:.4 },
  funny: { bpmMin: 126, bpmMax: 142, roots: [261.63, 293.66], progressions: [[0,7,9,7],[0,5,7,5],[0,9,7,5]], kickPatterns: [[0,2,4,6],[0,1,2,4]], hatDensities: [[0,2,4,5,6,7],[1,3,5,7]], claps: [[2,6]], padWaves:["square"], leadWaves:["square"], bassOctaveProb:.4, arpRate:1, swing:.22, energyCurve:"wave", padVol:.05, bassVol:.27, leadVol:.055, drumVol:.85 },
  motivational: { bpmMin: 116, bpmMax: 128, roots: [196, 220, 246.94], progressions: [[0,7,9,5],[0,5,10,8],[0,8,5,7]], kickPatterns: [[0,2,4,6],[0,4]], hatDensities: [[2,6],[1,3,5,7]], claps: [[2,6]], padWaves:["sawtooth"], leadWaves:["sawtooth","triangle"], bassOctaveProb:.6, arpRate:2, swing:.05, energyCurve:"build", padVol:.07, bassVol:.33, leadVol:.045, drumVol:.9 },
  storytelling: { bpmMin: 80, bpmMax: 92, roots: [174.61, 196, 220], progressions: [[0,5,7,9],[0,9,5,7],[0,3,5,8]], kickPatterns: [[0],[0,4]], hatDensities: [[4],[2,6]], claps: [[]], padWaves:["triangle"], leadWaves:["sine","triangle"], bassOctaveProb:.15, arpRate:4, swing:.16, energyCurve:"flat", padVol:.09, bassVol:.23, leadVol:.05, drumVol:.55 },
  relaxing: { bpmMin: 64, bpmMax: 76, roots: [164.81, 174.61, 196], progressions: [[0,5,7,10],[0,3,7,5]], kickPatterns: [[]], hatDensities: [[]], claps: [[]], padWaves:["sine"], leadWaves:["sine"], bassOctaveProb:0, arpRate:8, swing:.12, energyCurve:"flat", padVol:.12, bassVol:.17, leadVol:.03, drumVol:.3 },
  dramatic: { bpmMin: 90, bpmMax: 104, roots: [110, 123.47, 130.81], progressions: [[0,3,8,7],[0,5,3,10],[0,8,7,5]], kickPatterns: [[0,4],[0,2,4],[0,3,4,7]], hatDensities: [[3],[3,7]], claps: [[4]], padWaves:["sawtooth"], leadWaves:["sawtooth"], bassOctaveProb:.5, arpRate:2, swing:0, energyCurve:"drop", padVol:.07, bassVol:.36, leadVol:.04, drumVol:.95 },
};

const noteHz = (root: number, scale: number[], degree: number, oct = 0): number =>
  root * Math.pow(2, (scale[((degree % 7) + 7) % 7] + 12 * (Math.floor(degree / 7) + oct)) / 12);

export interface RenderedTrack {
  blob: Blob;
  url: string;
  duration: number;
  bpm: number;
  trackId: string;
  category: MusicCategory;
}

/**
 * Sintetiza una pista concreta durante `seconds` segundos.
 * Determinista: misma semilla → mismos parámetros musicales.
 */
export async function renderTrack(
  track: TrackDef,
  seconds: number,
  audioCtor?: typeof OfflineAudioContext
): Promise<RenderedTrack> {
  const P = PROFILES[track.category];
  const rnd = mulberry32(track.seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length];

  const bpm = Math.round(P.bpmMin + rnd() * (P.bpmMax - P.bpmMin));
  const root = pick(P.roots);
  const scale = rnd() > 0.72 ? MAJOR : MINOR;
  const prog = pick(P.progressions); // grados del acorde (raíz)
  const chordFromDegree = (deg: number): number[] => [
    noteHz(root, scale, deg),
    noteHz(root, scale, deg + 2),
    noteHz(root, scale, deg + 4),
  ];
  const kickPat = pick(P.kickPatterns);
  const hatPat = pick(P.hatDensities);
  const clapPat = pick(P.claps);
  const padWave = pick(P.padWaves);
  const leadWave = pick(P.leadWaves);
  const swing = P.swing * (rnd() > 0.5 ? 1 : 0.5);
  const introBars = P.energyCurve === "build" ? 2 : 0;

  const dur = Math.max(8, Math.min(45, seconds + 1));
  const sr = 44100;
  const OC =
    audioCtor ||
    (window.OfflineAudioContext as unknown as typeof OfflineAudioContext) ||
    ((window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext as typeof OfflineAudioContext);
  const ctx = new OC(2, Math.ceil(dur * sr), sr);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp);
  comp.connect(ctx.destination);

  const tone = (
    freq: number, t0: number, len: number, type: OscillatorType,
    vol: number, attack = 0.005, filterHz?: number, detune = 0
  ) => {
    if (!isFinite(freq) || freq <= 0) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
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

  const noiseHit = (t0: number, hp: number, vol: number, len: number) => {
    const buf = ctx.createBuffer(1, Math.ceil(len * sr), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = vol * P.drumVol;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  };
  const kick = (t0: number, vol = 0.9) => {
    if (P.drumVol <= 0) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * P.drumVol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  };

  const beat = 60 / bpm;
  const eighth = beat / 2;
  const bar = beat * 4;
  const bars = Math.ceil(dur / bar);

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    if (t0 > dur) break;
    const deg = prog[b % prog.length];
    const chord = chordFromDegree(deg);
    const inIntro = b < introBars;

    // Pad
    for (const fq of chord) tone(fq, t0, bar * 0.95, padWave, P.padVol, 0.08 + rnd() * 0.15, 2200);
    // Lead/arp sobre la escala
    for (let st = 0; st < 8; st += P.arpRate) {
      const swingOff = st % 2 === 1 ? swing * eighth : 0;
      const degreeOffset = [0, 2, 4, 6][(b + st) % 4];
      tone(
        noteHz(root, scale, deg + degreeOffset + 7), t0 + st * eighth + swingOff,
        eighth * 1.6, leadWave, inIntro ? P.leadVol * 0.5 : P.leadVol, 0.003, 5200
      );
    }
    if (!inIntro) {
      // Bajo
      for (let bt = 0; bt < 4; bt++) {
        const oct = rnd() < P.bassOctaveProb && bt % 2 === 1 ? 1 : 0;
        tone(noteHz(root, scale, deg, oct - 1), t0 + bt * beat, beat * 0.85, "sine", P.bassVol, 0.004, 700);
      }
      // Ritmo
      for (const st of kickPat) kick(t0 + st * eighth);
      for (const st of hatPat) {
        const swingOff = st % 2 === 1 ? swing * eighth : 0;
        noiseHit(t0 + st * eighth + swingOff, 8000, 0.16, 0.05);
      }
      for (const st of clapPat) noiseHit(t0 + st * eighth, 1800, 0.22, 0.09);
    }
  }

  const rendered = await ctx.startRendering();
  const L = rendered.getChannelData(0);
  const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;

  // WAV PCM16 estéreo
  const frames = L.length;
  const data = new Int16Array(frames * 2);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    let l = Math.max(-1, Math.min(1, L[i]));
    let r = Math.max(-1, Math.min(1, R[i]));
    data[o++] = l < 0 ? l * 0x8000 : l * 0x7fff;
    data[o++] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }
  const dataSize = frames * 4;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); ws(8, "WAVE");
  ws(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sr, true); view.setUint32(28, sr * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  ws(36, "data"); view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(data.buffer));

  const blob = new Blob([buffer], { type: "audio/wav" });
  return {
    blob,
    url: URL.createObjectURL(blob),
    duration: rendered.duration,
    bpm,
    trackId: track.id,
    category: track.category,
  };
}
