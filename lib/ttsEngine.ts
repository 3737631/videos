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

  // TROCEADOR DE TEXTO (Para que las APIs no lo bloqueen por ser muy largo)
  const textChunks = cleanText.match(/.{1,150}(?:\s|$)/g) || [cleanText];
  const audioBuffers: ArrayBuffer[] = [];

  for (const chunk of textChunks) {
    if (!chunk.trim()) continue;
    try {
      // INTENTO 1: Amazon Polly (Voz de mujer "Mia")
      let res = await fetch(`https://api.streamelements.com/kappa/v2/speech?voice=Mia&text=${encodeURIComponent(chunk.trim())}`);
      
      if (!res.ok) {
        // INTENTO 2 (FALLBACK ANTI-BLOQUEO): API oculta de Google Translate
        res = await fetch(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es-ES&client=gtx&q=${encodeURIComponent(chunk.trim())}`);
      }
      
      if (res.ok) {
        audioBuffers.push(await res.arrayBuffer());
      }
    } catch (e) {
      console.warn("Fallo al descargar un fragmento de voz.");
    }
  }

  // SI FALLAN TODAS LAS REDES (Cero internet o adblocker extremo)
  if (audioBuffers.length === 0) {
    // Genera una voz robótica que simula hablar, NUNCA MÚSICA.
    return { audioBlob: await generateRoboticVoice(rawWords, targetDurationSec), cues };
  }

  const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of audioBuffers) {
    merged.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  return { audioBlob: new Blob([merged], { type: "audio/mp3" }), cues };
}

// VOZ DE EMERGENCIA (Robot) - Solo se activa si falla el internet
async function generateRoboticVoice(words: string[], duration: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const offlineCtx = new AC(1, sampleRate * duration, sampleRate);
  
  const timePerWord = duration / words.length;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    
    // Calcula la frecuencia basándose en cuántas letras tiene la palabra
    osc.frequency.value = 300 + (word.length * 40);
    osc.type = "triangle";
    
    gain.gain.setValueAtTime(0.4, i * timePerWord);
    gain.gain.exponentialRampToValueAtTime(0.01, (i * timePerWord) + (timePerWord * 0.8));
    
    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    
    osc.start(i * timePerWord);
    osc.stop((i * timePerWord) + timePerWord);
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

// MÚSICA VIRAL - Ahora EXCLUSIVA del modo "Solo Música"
export async function generateViralMusic(duration: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const offlineCtx = new AC(1, sampleRate * (duration + 2), sampleRate);
  
  const bpm = 120;
  const beatTime = 60 / bpm; 
  
  for (let i = 0; i < duration + 2; i += beatTime) {
    const kick = offlineCtx.createOscillator();
    const kickGain = offlineCtx.createGain();
    kick.frequency.setValueAtTime(150, i);
    kick.frequency.exponentialRampToValueAtTime(0.01, i + 0.5);
    kickGain.gain.setValueAtTime(1, i);
    kickGain.gain.exponentialRampToValueAtTime(0.01, i + 0.5);
    kick.connect(kickGain);
    kickGain.connect(offlineCtx.destination);
    kick.start(i);
    kick.stop(i + 0.5);
    
    if (i + beatTime / 2 < duration + 2) {
      const hat = offlineCtx.createOscillator();
      const hatGain = offlineCtx.createGain();
      hat.type = "square";
      hat.frequency.setValueAtTime(8000, i + beatTime / 2);
      hatGain.gain.setValueAtTime(0.1, i + beatTime / 2);
      hatGain.gain.exponentialRampToValueAtTime(0.01, i + beatTime / 2 + 0.1);
      hat.connect(hatGain);
      hatGain.connect(offlineCtx.destination);
      hat.start(i + beatTime / 2);
      hat.stop(i + beatTime / 2 + 0.1);
    }
    
    const bass = offlineCtx.createOscillator();
    const bassGain = offlineCtx.createGain();
    bass.type = "triangle";
    bass.frequency.setValueAtTime(55, i); 
    bassGain.gain.setValueAtTime(0.6, i);
    bassGain.gain.exponentialRampToValueAtTime(0.01, i + beatTime);
    bass.connect(bassGain);
    bassGain.connect(offlineCtx.destination);
    bass.start(i);
    bass.stop(i + beatTime);
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

// Transformador de Audio
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
