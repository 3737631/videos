export type AppMode = "music" | "voice";

export interface VideoClip {
  file: File;
  url: string;
  startOffset: number;
  playDuration: number;
}

export interface SubtitleCue {
  text: string;
  start: number;
  end: number;
}

export interface RenderConfig {
  clips: VideoClip[];
  audioBuffer: AudioBuffer | null;
  audioContext: AudioContext;
  wordChunks: string[];
  mode: AppMode;
  targetDuration: number;
  onProgress: (progress: number) => void;
}
