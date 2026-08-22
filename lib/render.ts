import type { EditPlan, RenderValidation, Project } from "@/types";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { readFile, deleteFileSafe, ffprobeInfo } from "@/lib/ffmpeg";

export interface RenderOptions {
  targetWidth: number;
  targetHeight: number;
  fps: number;
  crf: number;
  onStage?: (stage: string, pct: number) => void;
}

function stage(options: RenderOptions, s: string, pct: number) {
  options.onStage?.(s, pct);
}

export async function renderProject(
  ffmpeg: FFmpeg,
  project: Project,
  options: RenderOptions
): Promise<{ blob: Blob; url: string; validation: RenderValidation }> {
  const { targetWidth = 1080, targetHeight = 1920, fps = 30, crf = 23 } = options;
  const plan = project.editPlan;
  if (!plan) throw new Error("No hay plan de edición");

  stage(options, "Preparando vídeo", 5);
  if (!project.sources.length) throw new Error("No hay fuentes de vídeo");

  const fallbackClip = {
    sourceId: project.sources[0].id,
    start: 0,
    end: 0,
    cropX: 0,
    cropY: 0,
    cropW: 0,
    cropH: 0,
    zoom: 1,
    speed: 1,
  };
  const clipsRaw = plan.clips.length
    ? plan.clips
    : [fallbackClip];
  const clips = clipsRaw.filter((c) =>
    project.sources.some((s) => s.id === c.sourceId)
  );
  const usedClips = clips.length ? clips : [fallbackClip];

  const usedSources: typeof project.sources = [];
  for (const c of usedClips) {
    if (!usedSources.some((s) => s.id === c.sourceId)) {
      const s = project.sources.find((x) => x.id === c.sourceId);
      if (s) usedSources.push(s);
    }
  }

  // Cargar cada fuente usada como input propio
  const inNames: string[] = [];
  const geoms: Record<number, Geom> = {};
  for (let i = 0; i < usedSources.length; i++) {
    const s = usedSources[i];
    stage(options, `Preparando vídeo ${i + 1}/${usedSources.length}`, 3 + Math.round(7 * ((i + 1) / usedSources.length)));
    const name = `in_${i}.mp4`;
    await readFile(ffmpeg, name, await (await fetch(s.url)).blob());
    inNames.push(name);
    const meta = await ffprobeInfo(ffmpeg, name);
    geoms[i] = {
      rawW: meta.width || s.width || 1920,
      rawH: meta.height || s.height || 1080,
      rotation: meta.rotation || 0,
      hasAudio: !!meta.hasAudio,
    };
  }

  let voiceName: string | null = null;
  if (plan.voice?.audioUrl) {
    voiceName = "voice.mp3";
    await readFile(ffmpeg, voiceName, await (await fetch(plan.voice.audioUrl)).blob());
  }

  let musicName: string | null = null;
  if (plan.music && project.music?.url) {
    musicName = "music.mp3";
    await readFile(ffmpeg, musicName, await (await fetch(project.music.url)).blob());
  }

  stage(options, "Generando subtítulos", 12);
  const subFiles: string[] = [];
  const cueCount = plan.subtitles.cues.length;
  for (let i = 0; i < cueCount; i++) {
    const cue = plan.subtitles.cues[i];
    const png = await renderSubtitlePng(cue, plan.subtitles.style, targetWidth, targetHeight);
    if (!png) continue;
    const name = `sub_${i}.png`;
    await ffmpeg.writeFile(name, new Uint8Array(await png.arrayBuffer()));
    subFiles.push(name);
  }

  stage(options, "Aplicando edición", 14);
  const srcIdxOf = (sourceId: string) => usedSources.findIndex((s) => s.id === sourceId);
  const graph = buildFilterGraph({
    clips: usedClips.map((c) => ({
      srcIdx: Math.max(0, srcIdxOf(c.sourceId)),
      start: c.start,
      end: c.end,
      zoom: c.zoom || 1,
    })),
    geoms,
    voiceName,
    musicName,
    subStartIdx: inNames.length + (voiceName ? 1 : 0) + (musicName ? 1 : 0),
    subFiles,
    cueTimes: plan.subtitles.cues.map((c) => [c.start, c.end] as [number, number]),
    audio: plan.audio,
    targetWidth,
    targetHeight,
    fps,
  });

  stage(options, "Renderizando", 65);
  const outName = "final.mp4";

  const args: string[] = ["-noautorotate"];
  for (const n of inNames) args.push("-i", n);
if (voiceName) args.push("-i", voiceName);
if (musicName) args.push("-stream_loop", "-1", "-i", musicName); // la música se repite hasta cubrir el vídeo completo
  for (const f of subFiles) args.push("-i", f);

  args.push(
    "-filter_complex", graph,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", String(crf),
    "-c:a", "aac",
    "-b:a", "192k",
    "-r", String(fps),
    "-movflags", "+faststart",
    "-y",
    outName
  );

  // Progreso real de la codificación (0..1) → 15%..90%, con tiempo restante estimado
  const renderT0 = Date.now();
  const onProg = ({ progress }: { progress: number }) => {
    const p = Math.min(1, Math.max(0, progress || 0));
    const el = (Date.now() - renderT0) / 1000;
    const eta = p > 0.04 ? Math.max(1, Math.round((el / p) * (1 - p))) : null;
    stage(
      options,
      eta !== null ? `Renderizando vídeo… quedan ~${eta}s` : "Renderizando vídeo…",
      15 + p * 75
    );
  };
  ffmpeg.on("progress", onProg);
  try {
    await ffmpeg.exec(args);
  } finally {
    ffmpeg.off("progress", onProg);
  }

  stage(options, "Comprobando calidad", 94);
  const outData = await ffmpeg.readFile(outName);
  const bytes = typeof outData === "string" ? new TextEncoder().encode(outData) : new Uint8Array(outData);
  const outBlob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
  const validation = await validateRender(ffmpeg, outName, outBlob);
  if (!validation.ok) {
    throw new Error(`Control de calidad falló: ${validation.errors.join("; ")}`);
  }

  for (const n of inNames) await deleteFileSafe(ffmpeg, n);
  if (voiceName) await deleteFileSafe(ffmpeg, voiceName);
  if (musicName) await deleteFileSafe(ffmpeg, musicName);
  for (const f of subFiles) await deleteFileSafe(ffmpeg, f);

  stage(options, "Finalizando", 100);
  const url = URL.createObjectURL(outBlob);
  return { blob: outBlob, url, validation };
}

interface GraphClip {
  srcIdx: number;
  start: number;
  end: number;
  zoom: number;
}

interface Geom {
  rawW: number;
  rawH: number;
  rotation: number;
  hasAudio: boolean;
}

interface GraphInput {
  clips: GraphClip[];
  geoms: Record<number, Geom>;
  voiceName: string | null;
  musicName: string | null;
  subStartIdx: number;
  subFiles: string[];
  cueTimes: [number, number][];
  audio: EditPlan["audio"];
  targetWidth: number;
  targetHeight: number;
  fps: number;
}

function buildFilterGraph(input: GraphInput): string {
  const parts: string[] = [];
  const aspect = input.targetWidth / input.targetHeight;

  // Cadena por clip: trim -> rotación -> crop 9:16 -> zoom
  input.clips.forEach((clip, j) => {
    const g = input.geoms[clip.srcIdx] || { rawW: 1920, rawH: 1080, rotation: 0, hasAudio: true };
    const { rotation } = g;
    let effW = g.rawW;
    let effH = g.rawH;
    let rotateFilter = "";
    if (rotation === 90) {
      rotateFilter = "transpose=1,";
      effW = g.rawH;
      effH = g.rawW;
    } else if (rotation === 270) {
      rotateFilter = "transpose=2,";
      effW = g.rawH;
      effH = g.rawW;
    } else if (rotation === 180) {
      rotateFilter = "hflip,vflip,";
    }

    let cropScale: string;
    if (effW / effH > aspect) {
      const cropW = Math.round(effH * aspect);
      const cropX = Math.max(0, Math.round((effW - cropW) / 2));
      cropScale = `crop=${cropW}:${effH}:${cropX}:0,scale=${input.targetWidth}:${input.targetHeight}`;
    } else {
      const cropH = Math.round(effW / aspect);
      const cropY = Math.max(0, Math.round((effH - cropH) / 2));
      cropScale = `crop=${effW}:${cropH}:0:${cropY},scale=${input.targetWidth}:${input.targetHeight}`;
    }

    const needTrim = clip.end > clip.start && clip.start >= 0;
    const trim = needTrim
      ? `trim=start=${Math.max(0, clip.start).toFixed(3)}:end=${clip.end.toFixed(3)},setpts=PTS-STARTPTS,`
      : "";

    const zoomMax = Math.max(1, Math.min(1.05, clip.zoom + 0.05));
    const zoom = `zoompan=z='min(1.0+0.0006*on,${zoomMax.toFixed(2)})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${input.targetWidth}x${input.targetHeight}:fps=${input.fps}`;

    parts.push(`[${clip.srcIdx}:v]${trim}${rotateFilter}${cropScale},${zoom}[vseg${j}]`);
  });

  // Concatenar segmentos
  let cur: string;
  if (input.clips.length > 1) {
    parts.push(
      `${input.clips.map((_, j) => `[vseg${j}]`).join("")}concat=n=${input.clips.length}:v=1:a=0[vcat]`
    );
    cur = "vcat";
  } else {
    cur = "vseg0";
  }

  // Subtítulos overlay
  input.subFiles.forEach((_f, i) => {
    const inputIdx = input.subStartIdx + i;
    const [s, e] = input.cueTimes[i] || [0, 0];
    parts.push(`[${inputIdx}:v]format=rgba[sub${i}]`);
    parts.push(`[${cur}][sub${i}]overlay=x=0:y=0:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[vsub${i}]`);
    cur = `vsub${i}`;
  });
  parts.push(`[${cur}]format=yuv420p[vout]`);

  // Audio con ducking: voz -> música -> original del primer clip
  const audioNodes: string[] = [];
  const totalDur = Math.max(0.5, input.clips.reduce((a, c) => a + Math.max(0, c.end - c.start), 0));
  const capMusic = input.musicName ? `,atrim=end=${totalDur.toFixed(3)},asetpts=N/SR/TB` : "";
  if (input.voiceName) {
    parts.push(`[${input.subStartIdx - (input.musicName ? 2 : 1)}:a]aresample=48000,aformat=channel_layouts=stereo[vo]`);
    audioNodes.push("[vo]");
  }
  if (input.musicName) {
    const musicIdx = input.subStartIdx - 1;
    parts.push(`[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${input.audio.musicVolume}[mu]`);
    audioNodes.push("[mu]");
  }
  const firstGeom = input.geoms[0];
  if (firstGeom?.hasAudio && input.audio.originalVolume > 0) {
    const fc = input.clips[0];
    const otrim =
      fc && fc.end > fc.start
        ? `atrim=start=${fc.start.toFixed(3)}:end=${fc.end.toFixed(3)},asetpts=PTS-STARTPTS,`
        : "";
    parts.push(`[0:a]${otrim}aresample=48000,aformat=channel_layouts=stereo,volume=${input.audio.originalVolume}[or]`);
    audioNodes.push("[or]");
  }

  if (audioNodes.length === 0) {
    parts.push("anullsrc=channel_layout=stereo:sample_rate=48000[aout]");
  } else if (audioNodes.length === 1) {
    parts.push(`${audioNodes[0]}${capMusic}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`);
  } else {
    parts.push(`${audioNodes.join("")}amix=inputs=${audioNodes.length}:duration=first:normalize=0${capMusic}[aout]`);
  }

  return parts.join(";");
}

export function renderSubtitlePng(
  cue: { text: string; words: { word: string; start: number; end: number }[] },
  style: {
    color: string;
    activeColor: string;
    size: number;
    weight: number;
    font: string;
    shadow: boolean;
    stroke: boolean;
    strokeColor: string;
    maxWidth: number;
  },
  width: number,
  height: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve(null);

    ctx.clearRect(0, 0, width, height);
    const safeY = height - Math.round(height * 0.16);
    const fontSize = style.size;
    ctx.font = `${style.weight} ${fontSize}px ${style.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const maxTextWidth = width * 0.86;
    const textWidth = Math.min(maxTextWidth, ctx.measureText(cue.text).width);

    ctx.fillStyle = "rgba(0,0,0,0.42)";
    const padding = fontSize * 0.6;
    roundRect(ctx, width / 2 - textWidth / 2 - padding, safeY - fontSize / 2 - padding, textWidth + padding * 2, fontSize + padding * 2, 14);
    ctx.fill();

    if (style.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
    }
    if (style.stroke) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = Math.max(2, Math.round(fontSize / 14));
      ctx.strokeText(cue.text, width / 2, safeY);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(cue.text, width / 2, safeY);

    if (cue.words.length) {
      const first = cue.words[0].word;
      const idx = cue.text.indexOf(first);
      if (idx >= 0) {
        const prefix = cue.text.slice(0, idx);
        const w0 = ctx.measureText(prefix).width;
        ctx.fillStyle = style.activeColor;
        ctx.fillText(first, width / 2 - textWidth / 2 + w0 + ctx.measureText(first).width / 2, safeY);
      }
    }
    ctx.shadowBlur = 0;

    canvas.toBlob(resolve, "image/png");
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function validateRender(
  ffmpeg: FFmpeg,
  filename: string,
  blob: Blob
): Promise<RenderValidation> {
  const info = await ffprobeInfo(ffmpeg, filename);
  const errors: string[] = [];
  if (!info.hasVideo) errors.push("Sin flujo de vídeo");
  if (!info.hasAudio) errors.push("Sin flujo de audio");
  if (info.width < 100 || info.height < 100) errors.push("Resolución inválida");
  if (info.duration < 0.5) errors.push("Duración demasiado corta");
  if (info.duration > 600) errors.push("Duración excesiva");

  return {
    ok: errors.length === 0,
    duration: info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    audioDuration: info.hasAudio ? info.duration : 0,
    sizeBytes: blob.size,
    codec: info.hasVideo ? "h264" : "",
    errors,
  };
}