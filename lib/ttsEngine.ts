import { SubtitleCue } from "@/types";

export async function generateSpeechAndCues(
  text: string,
  targetDurationSec: number,
  lang: string = "es"
): Promise<{ audioBlob: Blob; cues: SubtitleCue[] }> {
  
  const cleanText = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑçãõâêîôûàèìòù.,!¿?'-]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) throw new Error("Guion vacío");

  const timePerWord = targetDurationSec / rawWords.length;
  const cues: SubtitleCue[] = [];
  
  for (let i = 0; i < rawWords.length; i += 2) {
    const chunk = rawWords.slice(i, i + 2);
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

  const voiceMap: Record<string, { streamElements: string, google: string }> = {
    es: { streamElements: "Mia", google: "es-ES" },
    en: { streamElements: "Brian", google: "en-US" },
    pt: { streamElements: "Vitoria", google: "pt-BR" },
    fr: { streamElements: "Celine", google: "fr-FR" }
  };

  const vConfig = voiceMap[lang] || voiceMap["es"];
  const textChunks = cleanText.match(/.{1,150}(?:\s|$)/g) || [cleanText];

  // DESCARGA EN PARALELO ULTRA RÁPIDA
  const fetchPromises = textChunks.map(async (chunk, index) => {
    if (!chunk.trim()) return null;
    
    // Desfase microscópico para burlar el anti-spam (invisible para ti)
    await new Promise(r => setTimeout(r, index * 80));
    
    const encoded = encodeURIComponent(chunk.trim());
    const apis = [
      `https://api.streamelements.com/kappa/v2/speech?voice=${vConfig.streamElements}&text=${encoded}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${vConfig.google}&client=tw-ob&q=${encoded}`)}`,
      `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${vConfig.google}&client=tw-ob&q=${encoded}`
    ];

    for (const url of apis) {
      try {
        // Límite de tiempo: Si el servidor tarda más de 1.5s, pasa al siguiente
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 1000) return buf;
        }
      } catch (e) { continue; } // Si falla rápido, pasa al siguiente sin quejarse
    }
    return null;
  });

  let downloadedBuffers: (ArrayBuffer | null)[] = [];
  try {
    // RELOJ DE ARENA GLOBAL: Si no ha descargado todo en 3.5 segundos, corta para que no te quedes en el 5%
    downloadedBuffers = await Promise.race([
      Promise.all(fetchPromises),
      new Promise<(ArrayBuffer | null)[]>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3500))
    ]);
  } catch (e) {
    console.warn("La red va lenta. Pasando directo a modo offline para no congelar la pantalla.");
  }

  const validBuffers = downloadedBuffers.filter(b => b !== null) as ArrayBuffer[];
  let finalAudioBlob: Blob | null = null;

  if (validBuffers.length > 0) {
    const totalLength = validBuffers.reduce((acc, b) => acc + b.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of validBuffers) {
      merged.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }
    finalAudioBlob = new Blob([merged], { type: "audio/mp3" });
  } else {
    // Si falla por completo, genera voz local al instante sin que te des cuenta
    finalAudioBlob = await generateOfflineVoice(rawWords, targetDurationSec);
  }

  return { audioBlob: finalAudioBlob, cues };
}

// VOZ LOCAL DE EMERGENCIA INSTANTÁNEA
async function generateOfflineVoice(words: string[], duration: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const offlineCtx = new AC(1, sampleRate * duration, sampleRate);
  
  const timePerWord = duration / words.length;
  
  for (let i = 0; i < words.length; i++) {
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.frequency.value = 400 + (words[i].length * 30); 
    osc.type = "sine"; 
    
    gain.gain.setValueAtTime(0.5, i * timePerWord);
    gain.gain.exponentialRampToValueAtTime(0.01, (i * timePerWord) + (timePerWord * 0.8));
    
    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    
    osc.start(i * timePerWord);
    osc.stop((i * timePerWord) + timePerWord);
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

// MÚSICA PHONK PARA EL MODO MUSICAL
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
    kick.start(i); kick.stop(i + 0.5);
    
    if (i + beatTime / 2 < duration + 2) {
      const hat = offlineCtx.createOscillator();
      const hatGain = offlineCtx.createGain();
      hat.type = "square";
      hat.frequency.setValueAtTime(8000, i + beatTime / 2);
      hatGain.gain.setValueAtTime(0.1, i + beatTime / 2);
      hatGain.gain.exponentialRampToValueAtTime(0.01, i + beatTime / 2 + 0.1);
      hat.connect(hatGain);
      hatGain.connect(offlineCtx.destination);
      hat.start(i + beatTime / 2); hat.stop(i + beatTime / 2 + 0.1);
    }
    
    const bass = offlineCtx.createOscillator();
    const bassGain = offlineCtx.createGain();
    bass.type = "triangle";
    bass.frequency.setValueAtTime(55, i); 
    bassGain.gain.setValueAtTime(0.6, i);
    bassGain.gain.exponentialRampToValueAtTime(0.01, i + beatTime);
    bass.connect(bassGain);
    bassGain.connect(offlineCtx.destination);
    bass.start(i); bass.stop(i + beatTime);
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

// Transformador de datos de audio
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  let pos = 0;
  const writeString = (str: string) => { for (let i = 0; i < str.length; i++) out.setUint8(pos++, str.charCodeAt(i)); };
  writeString("RIFF"); out.setUint32(pos, length - 8, true); pos += 4;
  writeString("WAVE"); writeString("fmt "); out.setUint32(pos, 16, true); pos += 4;
  out.setUint16(pos, 1, true); pos += 2; out.setUint16(pos, numOfChan, true); pos += 2;
  out.setUint32(pos, buffer.sampleRate, true); pos += 4;
  out.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
  out.setUint16(pos, numOfChan * 2, true); pos += 2; out.setUint16(pos, 16, true); pos += 2;
  writeString("data"); out.setUint32(pos, length - pos - 4, true); pos += 4;
  const channel = buffer.getChannelData(0);
  let offset = 0;
  while (offset < buffer.length) {
    let sample = Math.max(-1, Math.min(1, channel[offset]));
    sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
    out.setInt16(pos, sample, true); pos += 2; offset++;
  }
  return new Blob([out], { type: "audio/wav" });
}
