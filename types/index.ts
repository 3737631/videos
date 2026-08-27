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
  startOffset: number;
  playDuration: number;
}

export type AppMode = "music" | "voice";

export interface RenderConfig {
  clips: VideoClip[];
  audioBlob: Blob | null;
  cues?: SubtitleCue[];
  wordChunks?: string[];
  mode: AppMode;
  targetDuration: number;
  onProgress: (pct: number) => void;
}
