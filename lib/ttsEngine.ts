import { SubtitleCue } from "@/types";

export async function generateSpeechAndCues(
  text: string,
  targetDurationSec: number
): Promise<{ audioBlob: Blob; cues: SubtitleCue[] }> {
  const cleanText = text.replace(/[*#_~]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  const timePerWord = targetDurationSec / rawWords.length;
  
  const cues: SubtitleCue[] = [];
  for (let i = 0; i < rawWords.length; i += 3) {
    const chunk = rawWords.slice(i, i + 3);
    cues.push({
      id: i,
      text: chunk.join(" "),
      start: i * timePerWord,
      end: (i + chunk.length) * timePerWord,
      words: chunk.map((word, idx) => ({
        text: word,
        start: (i + idx) * timePerWord,
        end: (i + idx + 1) * timePerWord,
      })),
    });
  }

  // Generamos un audio WAV en blanco del tiempo exacto (Aquí conectarías ElevenLabs/OpenAI Audio)
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const actx = new AudioContextClass();
  const numSamples = Math.floor(actx.sampleRate * targetDurationSec);
  const buffer = actx.createBuffer(1, numSamples, actx.sampleRate);
  
  // Rellenar con un ligero ruido blanco/vibración para que Safari no lo descarte
  const data = buffer.getChannelData(0);
  for (let i = 0; i < numSamples; i++) data[i] = (Math.random() * 2 - 1) * 0.05;

  const wavBlob = await new Promise<Blob>((resolve) => {
    // Conversión súper rápida a Blob WAV genérico
    resolve(new Blob([new Float32Array(data).buffer], { type: "audio/wav" }));
  });

  await actx.close();
  return { audioBlob: wavBlob, cues };
}
