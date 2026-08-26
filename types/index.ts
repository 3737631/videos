export interface SubtitleCue {
  id: number;
  text: string;
  start: number;
  end: number;
  words: Array<{ text: string; start: number; end: number }>;
}

export interface VideoClip {
  file: File;
  url: string;
  startOffset: number;  // NUEVO: En qué segundo exacto empieza el corte
  playDuration: number; // NUEVO: Cuánto dura este corte rápido (Ej: 2.5 seg)
}

export type AppMode = "music" | "voice";

export interface RenderConfig {
  clips: VideoClip[];
  audioBlob: Blob | null;
  cues: SubtitleCue[];
  mode: AppMode;
  targetDuration: number;
  onProgress: (pct: number) => void;
}
