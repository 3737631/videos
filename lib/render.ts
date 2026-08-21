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
  const source = project.sources[0];
  if (!source) throw new Error("No hay fuentes de vídeo");

  const inName = `in_${source.id}.mp4`;
  const inBlob = await (await fetch(source.url)).blob();
  await readFile(ffmpeg, inName, inBlob);
  const meta = await ffprobeInfo(ffmpeg, inName);

  // Dimensiones raw de FFmpeg (sin rotar) + rotación detectada
  const rawW = meta.width || source.width || 1920;
  const rawH = meta.height || source.height || 1080;
  const rotation = meta.rotation || 0;

  // Dimensiones efectivas después de rotar
  const isRotated = rotation === 90 || rotation === 270;
  const effectiveW = isRotated ? rawH : rawW;
  const effectiveH = isRotated ? rawW : rawH;

  stage(options, "Procesando clips", 15);
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

  stage(options, "Generando subtítulos", 25);
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

  stage(options, "Aplicando edición", 40);
  const graph = buildFilterGraph({
    rawW,
    rawH,
    rotation,
    hasOriginalAudio: meta.hasAudio,
    voiceName,
    musicName,
    subFiles,
    cueTimes: plan.subtitles.cues.map((c) => [c.start, c.end] as [number, number]),
    audio: plan.audio,
    targetWidth,
    targetHeight,
    fps,
  });

  stage(options, "Renderizando", 65);
  const outName = "final.mp4";

  // -noautorotate: manejamos la rotación en el filter graph
  // -map 0:v:0 -map 0:a:0: primer stream de vídeo y audio (evita streams múltiples de TikTok)
  const args: string[] = ["-noautorotate", "-i", inName];
  if (voiceName) args.push("-i", voiceName);
  if (musicName) args.push("-i", musicName);
  for (const f of subFiles) args.push("-i", f);

  args.push(
    "-filter_complex", graph,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", String(crf),
    "-c:a", "aac",
    "-b:a", "192k",
    "-r", String(fps),
    "-movflags", "+faststart",
    "-y",
    outName
  );

  await ffmpeg.exec(args);

  stage(options, "Comprobando calidad", 88);
  const outData = await ffmpeg.readFile(outName);
  const bytes = typeof outData === "string" ? new TextEncoder().encode(outData) : new Uint8Array(outData);
  const outBlob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
  const validation = await validateRender(ffmpeg, outName, outBlob);
  if (!validation.ok) {
    throw new Error(`Control de calidad falló: ${validation.errors.join("; ")}`);
  }

  await deleteFileSafe(ffmpeg, inName);
  if (voiceName) await deleteFileSafe(ffmpeg, voiceName);
  if (musicName) await deleteFileSafe(ffmpeg, musicName);
  for (const f of subFiles) await deleteFileSafe(ffmpeg, f);

  stage(options, "Finalizando", 100);
  const url = URL.createObjectURL(outBlob);
  return { blob: outBlob, url, validation };
}

interface GraphInput {
  rawW: number;
  rawH: number;
  rotation: number;
  hasOriginalAudio: boolean;
  voiceName: string | null;
  musicName: string | null;
  subFiles: string[];
  cueTimes: [number, number][];
  audio: EditPlan["audio"];
  targetWidth: number;
  targetHeight: number;
  fps: number;
}

function buildFilterGraph(input: GraphInput): string {
  const parts: string[] = [];
  const { rawW, rawH, rotation } = input;
  const aspect = input.targetWidth / input.targetHeight;

  // Paso 1: rotación (si needed)
  let rotateFilter = "";
  let effW = rawW;
  let effH = rawH;

  if (rotation === 90) {
    rotateFilter = "transpose=1,";
    effW = rawH;
    effH = rawW;
  } else if (rotation === 270) {
    rotateFilter = "transpose=2,";
    effW = rawH;
    effH = rawW;
  } else if (rotation === 180) {
    rotateFilter = "hflip,vflip,";
    effW = rawW;
    effH = rawH;
  }
  // rotation 0 o 360: sin filtro

  // Paso 2: crop centrado 9:16 basado en dimensiones efectivas
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

  // Paso 3: zoom dinámico suave (105% máximo)
  const zoom = `zoompan=z='min(1.0+0.0006*on,1.05)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${input.targetWidth}x${input.targetHeight}:fps=${input.fps}`;

  parts.push(`[0:v]${rotateFilter}${cropScale},${zoom}[vbase]`);

  // Paso 4: subtítulos overlay
  let cur = "vbase";
  input.subFiles.forEach((_f, i) => {
    const inputIdx = i + 1 + (input.voiceName ? 1 : 0) + (input.musicName ? 1 : 0);
    const [s, e] = input.cueTimes[i] || [0, 0];
    const label = `vsub${i}`;
    parts.push(`[${inputIdx}:v]format=rgba[sub${i}]`);
    parts.push(`[${cur}][sub${i}]overlay=x=0:y=0:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[${label}]`);
    cur = label;
  });
  parts.push(`[${cur}]format=yuv420p[vout]`);

  // Paso 5: audio con ducking
  const audioNodes: string[] = [];
  if (input.voiceName) {
    parts.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo[vo]`);
    audioNodes.push("[vo]");
  }
  if (input.musicName) {
    const musicIdx = input.voiceName ? 2 : 1;
    parts.push(`[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${input.audio.musicVolume}[mu]`);
    audioNodes.push("[mu]");
  }
  if (input.hasOriginalAudio) {
    parts.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${input.audio.originalVolume}[or]`);
    audioNodes.push("[or]");
  }

  if (audioNodes.length === 0) {
    parts.push("anullsrc=channel_layout=stereo:sample_rate=48000[aout]");
  } else if (audioNodes.length === 1) {
    parts.push(`${audioNodes[0]}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`);
  } else {
    parts.push(`${audioNodes.join("")}amix=inputs=${audioNodes.length}:duration=first:normalize=0[aout]`);
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