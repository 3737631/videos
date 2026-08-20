import type { MusicTrack } from "@/types";

export async function probeAudioMeta(url: string): Promise<{ duration: number }> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      resolve({ duration: isFinite(audio.duration) ? audio.duration : 0 });
    audio.onerror = () => resolve({ duration: 0 });
    audio.src = url;
  });
}

export async function createMusicTrack(file: File): Promise<MusicTrack> {
  const url = URL.createObjectURL(file);
  const { duration } = await probeAudioMeta(url);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ""),
    duration: Math.round(duration * 10) / 10,
    bpm: 0,
    category: "personal",
    url,
  };
}

export const DEMO_MUSIC: MusicTrack[] = [
  {
    id: "demo-upbeat",
    name: "Upbeat energía (demo)",
    duration: 0,
    bpm: 124,
    category: "energética",
    url: "",
  },
  {
    id: "demo-chill",
    name: "Chill suave (demo)",
    duration: 0,
    bpm: 90,
    category: "relajada",
    url: "",
  },
];

export async function generateTone(url: string, frequency = 440, seconds = 2): Promise<string> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = 0;
  ctx.close().catch(() => {});
  return url;
}