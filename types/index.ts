export type AppMode = "music" | "voice";

export interface VideoClip {
  file: File;
  url: string;
  startOffset: number;
  playDuration: number;
}

export interface RenderConfig {
  clips: VideoClip[];
  audioBlob: Blob | null;
  wordChunks: string[];
  mode: AppMode;
  targetDuration: number;
  onProgress: (progress: number) => void;
}
