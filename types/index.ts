export type ProjectStatus = "draft" | "processing" | "ready" | "failed" | "exported";

export type ExportTarget = "tiktok" | "reels" | "shorts" | "custom";

export type VideoStyle =
  | "viral"
  | "ugc"
  | "producto"
  | "storytelling"
  | "review"
  | "tutorial"
  | "lifestyle"
  | "anuncio";

export type VideoGoal = "ventas" | "seguidores" | "retencion" | "engagement" | "branding";

export interface SourceVideo {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface SceneInfo {
  start: number;
  end: number;
  score: number;
  type: "people" | "product" | "scene" | "empty" | "action";
}

export interface SilenceSegment {
  start: number;
  end: number;
  duration: number;
}

export interface AudioAnalysis {
  speech: number;
  silenceSegments: SilenceSegment[];
  audioLevel: number;
  loudness: number;
}

export interface VideoMetadata {
  scenes: SceneInfo[];
  duration: number;
  resolution: { width: number; height: number };
  fps: number;
  people: number;
  objects: string[];
  speech: number;
  silenceSegments: SilenceSegment[];
  sceneChanges: number;
  interestingSegments: number[];
  audioLevel: number;
  qualityScore: number;
  analysisText: string;
}

export interface HookOption {
  id: string;
  text: string;
  score: number;
}

export interface ScriptSegment {
  kind: "hook" | "desarrollo" | "beneficio" | "prueba" | "cta";
  text: string;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: "femenina" | "masculina" | "neutra";
  style: string;
  language: string;
  accent: string;
  speed: number;
}

export interface VoiceSettings {
  voiceId: string;
  voiceName: string;
  provider: string;
  speed: number;
  pitch: number;
}

export interface MusicTrack {
  id: string;
  name: string;
  duration: number;
  bpm: number;
  category: string;
  url: string;
}

export interface EditClip {
  sourceId: string;
  start: number;
  end: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  zoom: number;
  speed: number;
}

export interface EditPlan {
  format: "9:16";
  duration: number;
  targetDuration: number;
  clips: EditClip[];
  voice: {
    audioUrl: string;
    duration: number;
    volume: number;
  } | null;
  subtitles: {
    cues: SubtitleCue[];
    style: SubtitleStyle;
  };
  music: {
    trackId: string;
    volume: number;
  } | null;
  overlays: TextOverlay[];
  transitions: string[];
  audio: {
    voiceVolume: number;
    musicVolume: number;
    originalVolume: number;
  };
}

export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  position: "top" | "center" | "bottom";
  style: "hook" | "cta" | "label";
}

export interface SubtitleStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
  activeColor: string;
  shadow: boolean;
  stroke: boolean;
  strokeColor: string;
  position: "bottom" | "center" | "top";
  maxWidth: number;
  animation: "pop" | "fade" | "slide" | "none";
}

export interface RenderJob {
  id: string;
  projectId: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  progress: number;
  error?: string;
  outputUrl?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface RenderValidation {
  ok: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioDuration: number;
  sizeBytes: number;
  codec: string;
  errors: string[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  sources: SourceVideo[];
  metadata: VideoMetadata | null;
  style: VideoStyle;
  goal: VideoGoal;
  targetDuration: "auto" | 15 | 30 | 45 | 60 | 90;
  hooks: HookOption[];
  selectedHook: string;
  script: ScriptSegment[];
  voice: VoiceSettings | null;
  subtitles: { cues: SubtitleCue[]; style: SubtitleStyle };
  music: MusicTrack | null;
  editPlan: EditPlan | null;
  renders: RenderJob[];
  thumbnail: string;
  removeWatermark?: boolean;
  renderUrl?: string;
  renderValidation?: RenderValidation;
}

export interface AppSettings {
  llmProvider: "openai" | "groq";
  llmApiKey: string;
  llmModel: string;
  ttsProvider: "openai" | "elevenlabs";
  ttsApiKey: string;
  ttsVoiceId: string;
  sttProvider: "openai" | "groq";
  sttApiKey: string;
}

export interface ServiceStatus {
  configured: boolean;
  missing: string[];
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}