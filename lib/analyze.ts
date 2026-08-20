import type { SourceVideo, VideoMetadata, SceneInfo, SilenceSegment } from "@/types";

interface FrameSample {
  time: number;
  data: Uint8Array;
  brightness: number;
}

function downsampleFrame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bucketW = 32;
  const bucketH = 32;
  ctx.drawImage(canvas, 0, 0, w, h, 0, 0, bucketW, bucketH);
  const data = ctx.getImageData(0, 0, bucketW, bucketH).data;
  const out = new Uint8Array(bucketW * bucketH);
  let sum = 0;
  for (let i = 0; i < bucketW * bucketH; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = luma;
    sum += luma;
  }
  return { data: out, brightness: sum / (bucketW * bucketH) };
}

function frameDiff(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return 1;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / (a.length * 255);
}

export async function analyzeVideo(
  src: SourceVideo,
  onProgress?: (stage: string, pct: number) => void
): Promise<VideoMetadata> {
  const video = document.createElement("video");
  video.muted = true;
  video.src = src.url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("No se pudo cargar el vídeo para análisis"));
  });

  const duration = src.duration || video.duration;
  const width = src.width;
  const height = src.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas no disponible");

  const samples: FrameSample[] = [];
  const interval = Math.max(0.5, Math.min(1, duration / 60));
  const nSamples = Math.max(8, Math.min(60, Math.floor(duration / interval)));

  for (let i = 0; i < nSamples; i++) {
    const t = Math.min(duration - 0.05, (i * duration) / nSamples);
    onProgress?.("Analizando vídeo", Math.round((i / nSamples) * 100));
    video.currentTime = t;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 400);
    });
    ctx.drawImage(video, 0, 0, width, height);
    samples.push({
      time: t,
      ...downsampleFrame(canvas, ctx, width, height),
    });
  }

  onProgress?.("Detectando escenas", 70);

  const scenes: SceneInfo[] = [];
  let sceneStart = 0;
  let lastSample = samples[0];
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const diff = frameDiff(lastSample.data, s.data);
    if (diff > 0.28) {
      scenes.push({
        start: sceneStart,
        end: s.time,
        score: Math.min(1, diff * 1.5),
        type: "scene",
      });
      sceneStart = s.time;
    }
    lastSample = s;
  }
  if (sceneStart < duration - 0.1) {
    scenes.push({
      start: sceneStart,
      end: duration,
      score: 0.6,
      type: "scene",
    });
  }

  const sceneChanges = scenes.length;

  // Detección de "personas/producto" aproximada por variación y brillo.
  const peopleScore = samples.reduce((acc, s) => acc + (s.brightness > 60 ? 1 : 0), 0) / samples.length;
  const people = Math.max(0, Math.round(peopleScore * 3));
  const objects = people > 1 ? ["persona(s) detectada(s)"] : ["contenido visual"];

  onProgress?.("Analizando audio", 80);
  const audio = await analyzeAudio(src);

  const interestingSegments = scenes
    .filter((s) => s.score > 0.5)
    .map((s) => Math.round(s.start * 10) / 10);

  const qualityScore = computeQualityScore(width, height, duration, audio, scenes);
  const speech = audio.speech;

  onProgress?.("Preparando edición", 95);

  const analysisText = buildAnalysisText({
    duration,
    width,
    height,
    fps: src.fps,
    sceneChanges,
    people,
    speech,
    qualityScore,
    audioLevel: audio.audioLevel,
  });

  return {
    scenes,
    duration,
    resolution: { width, height },
    fps: src.fps,
    people,
    objects,
    speech,
    silenceSegments: audio.silenceSegments,
    sceneChanges,
    interestingSegments,
    audioLevel: audio.audioLevel,
    qualityScore,
    analysisText,
  };
}

async function analyzeAudio(src: SourceVideo) {
  const res = await fetch(src.url);
  const blob = await res.blob();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;

  const windowSize = Math.floor(sampleRate * 0.5);
  const windows: number[] = [];
  for (let i = 0; i < channel.length; i += windowSize) {
    let sum = 0;
    const end = Math.min(i + windowSize, channel.length);
    for (let j = i; j < end; j++) sum += channel[j] * channel[j];
    windows.push(Math.sqrt(sum / (end - i)));
  }
  const meanLevel = windows.length ? windows.reduce((a, b) => a + b, 0) / windows.length : 0;
  const speechThreshold = meanLevel * 0.6;
  const speechWindows = windows.filter((w) => w > speechThreshold).length;
  const speech = windows.length ? speechWindows / windows.length : 0;

  const silenceSegments: SilenceSegment[] = [];
  let silent = false;
  let segStart = 0;
  for (let i = 0; i < windows.length; i++) {
    const isSilent = windows[i] < meanLevel * 0.12;
    const t = i * 0.5;
    if (isSilent && !silent) {
      silent = true;
      segStart = t;
    } else if (!isSilent && silent) {
      const dur = t - segStart;
      if (dur >= 0.6) silenceSegments.push({ start: segStart, end: t, duration: dur });
      silent = false;
    }
  }
  if (silent && windows.length * 0.5 - segStart >= 0.6) {
    silenceSegments.push({ start: segStart, end: windows.length * 0.5, duration: windows.length * 0.5 - segStart });
  }

  ctx.close().catch(() => {});
  return { speech, silenceSegments, audioLevel: meanLevel, loudness: Math.max(0, Math.min(1, meanLevel * 3)) };
}

function computeQualityScore(
  width: number,
  height: number,
  duration: number,
  audio: { audioLevel: number },
  scenes: SceneInfo[]
) {
  let score = 50;
  const res = width * height;
  if (res >= 1920 * 1080) score += 20;
  else if (res >= 1280 * 720) score += 12;
  else if (res >= 640 * 360) score += 5;
  if (duration >= 10) score += 10;
  if (audio.audioLevel > 0.01) score += 10;
  if (scenes.length > 0) score += 5;
  if (scenes.length > 5) score += 5;
  return Math.min(100, score);
}

function buildAnalysisText(info: {
  duration: number;
  width: number;
  height: number;
  fps: number;
  sceneChanges: number;
  people: number;
  speech: number;
  qualityScore: number;
  audioLevel: number;
}) {
  const lines: string[] = [];
  lines.push(`Vídeo de ${info.duration.toFixed(1)}s a ${info.width}x${info.height} (${info.fps.toFixed(1)} fps).`);
  lines.push(
    info.width > info.height
      ? "Material horizontal, requiere reencuadre vertical 9:16."
      : "Material vertical, compatible con 9:16."
  );
  lines.push(`Se detectaron ${info.sceneChanges} cambios de plano.`);
  if (info.people >= 2) lines.push(`Parece haber ${info.people} personas en pantalla.`);
  lines.push(
    info.speech > 0.25
      ? "Hay voz o diálogo durante una parte importante del vídeo."
      : "El vídeo tiene poco diálogo; la voz en off tendrá más protagonismo."
  );
  lines.push(`Calidad estimada: ${info.qualityScore}/100.`);
  return lines.join(" ");
}