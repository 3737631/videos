import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let ffprobeUrl: string | null = null;

const CDN = "https://cdn.jsdelivr.net/npm";

export function isFfmpegReady() {
  return ffmpeg !== null;
}

export function isFfmpegLoaded() {
  return ffmpeg !== null;
}

export function getFfmpeg(): FFmpeg {
  if (!ffmpeg) throw new Error("FFmpeg no está cargado todavía.");
  return ffmpeg;
}

const LOAD_TIMEOUT_MS = 120000;

export async function loadFfmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  const instance = new FFmpeg();
  if (onLog) {
    instance.on("log", ({ message }) => onLog(message));
  }
  const base = `${CDN}/@ffmpeg/core@0.12.10/dist/umd`;
  const utilBase = `${CDN}/@ffmpeg/util@0.12.2/dist/umd`;

  // Carga con tope de tiempo: la promesa SIEMPRE termina y el timer se limpia.
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await instance.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
          workerURL: await toBlobURL(`${utilBase}/index.umd.js`, "text/javascript"),
        });
      })(),
      new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error("El motor de vídeo tardó demasiado en cargar. Comprueba tu conexión e inténtalo de nuevo.")),
          LOAD_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timerId) clearTimeout(timerId);
  }

  ffmpeg = instance;
  ffprobeUrl = `${base}/ffmpeg-core.js`;
  return instance;
}

export async function resetFfmpeg() {
  ffmpeg = null;
  ffprobeUrl = null;
}

export async function fileToUint8(file: File | Blob): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function readFile(ffmpeg: FFmpeg, name: string, file: File | Blob) {
  const data = await fileToUint8(file);
  await ffmpeg.writeFile(name, data);
  return name;
}

export async function ffprobeInfo(
  ffmpeg: FFmpeg,
  filename: string
): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  rotation: number;
}> {
  const logLines: string[] = [];
  const onLog = ({ message }: { message: string }) => logLines.push(message);
  ffmpeg.on("log", onLog);
  let returnCode = -1;
  try {
    returnCode = await ffmpeg.exec(["-noautorotate", "-i", filename]);
  } catch (e) {
    void e;
  } finally {
    ffmpeg.off("log", onLog);
  }
  const log = logLines.join("\n");
  if (!log && returnCode === 0) return { duration: 0, width: 0, height: 0, fps: 0, hasAudio: false, hasVideo: false, rotation: 0 };
  const durationMatch = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration =
    durationMatch
      ? parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseFloat(durationMatch[3])
      : 0;
  const videoMatch = log.match(
    /Video:.*?(\d{2,5})x(\d{2,5}).*?(\d+(?:\.\d+)?)\s*fps/
  );
  const width = videoMatch ? parseInt(videoMatch[1]) : 0;
  const height = videoMatch ? parseInt(videoMatch[2]) : 0;
  const fps = videoMatch ? parseFloat(videoMatch[3]) : 0;
  const hasAudio = /Audio:/.test(log);
  const hasVideo = /Video:/.test(log);

  let rotation = 0;
  const rotateMatch = log.match(/rotate\s*:\s*(\d+)/i);
  if (rotateMatch) rotation = parseInt(rotateMatch[1]) % 360;
  if (!rotation) {
    const sideMatch = log.match(/displaymatrix.*?rotation\s*[=:]\s*(-?\d+)/i);
    if (sideMatch) rotation = (parseInt(sideMatch[1]) + 360) % 360;
  }

  return { duration, width, height, fps, hasAudio, hasVideo, rotation };
}

export async function extractThumbnail(
  ffmpeg: FFmpeg,
  inputFile: string,
  timeSeconds: number
): Promise<string | null> {
  const out = "thumb.jpg";
  try {
    await ffmpeg.exec([
      "-ss",
      String(timeSeconds),
      "-i",
      inputFile,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      out,
    ]);
    const data = await ffmpeg.readFile(out);
    await ffmpeg.deleteFile(out);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function deleteFileSafe(ffmpeg: FFmpeg, name: string) {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // no existe
  }
}

export { fetchFile };