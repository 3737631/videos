import { SubtitleCue } from "@/types";

export async function generateSpeechAndCues(
  text: string,
  targetDurationSec: number
): Promise<{ audioBlob: Blob; cues: SubtitleCue[] }> {
  const cleanText = text.replace(/[*#_~]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  
  if (rawWords.length === 0) throw new Error("Guion vacío");

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

  // GENERADOR DE VOZ ROBÓTICA (Estilo Animal Crossing / Retro)
  // Genera ondas de sonido reales para que puedas escuchar que el sistema funciona.
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const actx = new AC();
  const sampleRate = actx.sampleRate;
  const numSamples = Math.floor(sampleRate * targetDurationSec);
  const buffer = actx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < rawWords.length; i++) {
    const word = rawWords[i];
    const wordStartSample = Math.floor(i * timePerWord * sampleRate);
    const wordEndSample = Math.floor((i + 0.8) * timePerWord * sampleRate); // Silencio entre palabras

    // Tono aleatorio basado en la palabra para simular que "habla"
    const freq = 300 + (word.length * 50);

    for (let j = wordStartSample; j < wordEndSample && j < numSamples; j++) {
      const t = (j - wordStartSample) / sampleRate;
      // Onda matemática que suena como un robot
      data[j] = Math.sin(2 * Math.PI * freq * t) * 0.4; 
    }
  }

  const wavBlob = audioBufferToWav(buffer);
  await actx.close();

  return { audioBlob: wavBlob, cues };
}

// Transformador matemático de Audio a Archivo WAV real
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  let pos = 0;

  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) out.setUint8(pos++, str.charCodeAt(i));
  };

  writeString("RIFF");
  out.setUint32(pos, length - 8, true); pos += 4;
  writeString("WAVE");
  writeString("fmt ");
  out.setUint32(pos, 16, true); pos += 4;
  out.setUint16(pos, 1, true); pos += 2;
  out.setUint16(pos, numOfChan, true); pos += 2;
  out.setUint32(pos, buffer.sampleRate, true); pos += 4;
  out.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
  out.setUint16(pos, numOfChan * 2, true); pos += 2;
  out.setUint16(pos, 16, true); pos += 2;
  writeString("data");
  out.setUint32(pos, length - pos - 4, true); pos += 4;

  const channel = buffer.getChannelData(0);
  let offset = 0;
  while (offset < buffer.length) {
    let sample = Math.max(-1, Math.min(1, channel[offset]));
    sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
    out.setInt16(pos, sample, true);
    pos += 2;
    offset++;
  }

  return new Blob([out], { type: "audio/wav" });
}
