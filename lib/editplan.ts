import type {
  EditPlan,
  Project,
  ScriptSegment,
  SubtitleStyle,
  SubtitleCue,
} from "@/types";

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    size: 64,
    weight: 800,
    color: "#ffffff",
    activeColor: "#fde047",
    shadow: true,
    stroke: false,
    strokeColor: "#000000",
    position: "bottom",
    maxWidth: 86,
    animation: "pop",
  };
}

export const SUBTITLE_PRESETS: Record<string, SubtitleStyle> = {
  "clasico": defaultSubtitleStyle(),
  "grande": {
    ...defaultSubtitleStyle(),
    size: 96,
    weight: 900,
    position: "center",
  },
  "dinamico": {
    ...defaultSubtitleStyle(),
    size: 72,
    weight: 800,
    activeColor: "#22d3ee",
    animation: "pop",
  },
  "ugc": {
    ...defaultSubtitleStyle(),
    font: "'Segoe UI', system-ui, sans-serif",
    size: 60,
    weight: 700,
    activeColor: "#fbbf24",
    shadow: false,
    stroke: true,
    strokeColor: "#000000",
  },
  "minimalista": {
    ...defaultSubtitleStyle(),
    size: 52,
    weight: 600,
    color: "#f9fafb",
    activeColor: "#93c5fd",
    shadow: false,
  },
  "energetico": {
    ...defaultSubtitleStyle(),
    size: 76,
    weight: 900,
    activeColor: "#f472b6",
    animation: "pop",
  },
};

export function buildEditPlan(project: Project): EditPlan {
  const meta = project.metadata;
  const cues = project.subtitles.cues;
  const targetDuration = resolveTargetDuration(project.targetDuration, meta?.duration || 0);

  // La voz manda si existe; si no, el último subtítulo; nunca 0 por accidente.
  const lastCueEnd = cues.length ? cues[cues.length - 1].end || 0 : 0;
  const planVoiceDuration = project.editPlan?.voice?.duration || 0;
  const voiceDuration = Math.max(planVoiceDuration, lastCueEnd);

  const duration = Math.max(targetDuration, voiceDuration, meta?.duration || 0);

  return {
    format: "9:16",
    duration,
    targetDuration,
    clips: meta?.scenes?.length
      ? meta.scenes.map((s) => ({
          sourceId: s.sourceId || project.sources[0]?.id || "",
          start: s.start,
          end: s.end,
          cropX: 0,
          cropY: 0,
          cropW: 0,
          cropH: 0,
          zoom: s.score > 0.6 ? 1.05 : 1,
          speed: 1,
        }))
      : [],
    voice: project.editPlan?.voice || null,
    subtitles: {
      cues,
      style: project.subtitles.style,
    },
    music: project.music ? { trackId: project.music.id, volume: 0.22 } : null,
    overlays: [],
    transitions: [],
    audio: {
      voiceVolume: 1.0,
      musicVolume: 0.22,
      originalVolume: project.sources[0]?.hasAudio ? 0.25 : 0,
    },
  };
}

function resolveTargetDuration(mode: Project["targetDuration"], sourceDuration: number): number {
  if (mode === "auto") {
    if (sourceDuration <= 20) return sourceDuration;
    if (sourceDuration <= 35) return 30;
    if (sourceDuration <= 55) return 45;
    return 60;
  }
  return mode;
}

export function scriptToSpeechText(script: ScriptSegment[]): string {
  return script.map((s) => s.text).filter(Boolean).join(". ");
}

export function estimateSubtitleCuesFromScript(
  script: ScriptSegment[],
  voiceDuration: number
): SubtitleCue[] {
  const texts = script.map((s) => s.text).filter(Boolean);
  const totalChars = texts.reduce((acc, t) => acc + t.length, 0);
  if (!totalChars) return [];
  const cues: SubtitleCue[] = [];
  let elapsed = 0;
  for (const text of texts) {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const frac = text.length / totalChars;
    const cueDur = frac * voiceDuration;
    const start = elapsed;
    const end = elapsed + cueDur;
    const wordTimes: { word: string; start: number; end: number }[] = [];
    const perWord = cueDur / words.length;
    words.forEach((w, i) => {
      wordTimes.push({
        word: w,
        start: start + i * perWord,
        end: start + (i + 1) * perWord,
      });
    });
    cues.push({ start, end, text, words: wordTimes });
    elapsed = end;
  }
  return cues;
}

export function getScriptFullText(project: Project): string {
  return project.script.map((s) => s.text).filter(Boolean).join(". ");
}