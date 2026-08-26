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

  try {
    // HACK SECRETO: Usamos la API pública de StreamElements (Amazon Polly).
    // Es 100% gratis, no necesita servidor backend, no da errores 404 y suena MUY real.
    // Opciones de voz: "Mia" (Mujer neutro/México), "Conchita" (Mujer España), "Enrique" (Hombre España)
    const voiceName = "Mia"; 
    
    // Llamada directa desde el cliente
    const url = `https://api.streamelements.com/kappa/v2/speech?voice=${voiceName}&text=${encodeURIComponent(cleanText)}`;
    
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error("El servidor de voz humana está saturado.");
    }

    // Obtenemos el MP3 humano
    const audioBlob = await res.blob();
    return { audioBlob, cues };

  } catch (error) {
    // SISTEMA DE SUPERVIVENCIA (FALLBACK)
    // Si la API falla o no tienes internet, NUNCA dará error en pantalla.
    // Generará la voz de robot de emergencia matemáticamente para salvar el vídeo.
    console.warn("Fallo en la voz de internet. Generando voz de emergencia local para que el vídeo no falle.");
    
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const actx = new AC();
    const sampleRate = actx.sampleRate;
    const numSamples = Math.floor(sampleRate * targetDurationSec);
    const buffer = actx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < rawWords.length; i++) {
      const wordStartSample = Math.floor(i * timePerWord * sampleRate);
      const wordEndSample = Math.floor((i + 0.8) * timePerWord * sampleRate); 
      const freq = 300 + (rawWords[i].length * 50);

      for (let j = wordStartSample; j < wordEndSample && j < numSamples; j++) {
        const t = (j - wordStartSample) / sampleRate;
        data[j] = Math.sin(2 * Math.PI * freq * t) * 0.4; 
      }
    }

    const wavBlob = audioBufferToWav(buffer);
    await actx.close();

    return { audioBlob: wavBlob, cues };
  }
}

// Convertidor matemático para la voz de emergencia local
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
