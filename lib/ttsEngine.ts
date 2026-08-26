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

  // Mapeo de Voces según el Idioma
  const voiceMap: Record<string, { streamElements: string, google: string }> = {
    es: { streamElements: "Mia", google: "es-ES" },
    en: { streamElements: "Brian", google: "en-US" },
    pt: { streamElements: "Vitoria", google: "pt-BR" },
    fr: { streamElements: "Celine", google: "fr-FR" }
  };

  const vConfig = voiceMap[lang] || voiceMap["es"];
  const textChunks = cleanText.match(/.{1,90}(?:\s|$)/g) || [cleanText];
  const audioBuffers: ArrayBuffer[] = [];

  for (const chunk of textChunks) {
    if (!chunk.trim()) continue;
    const encoded = encodeURIComponent(chunk.trim());
    
    const apis = [
      `https://api.streamelements.com/kappa/v2/speech?voice=${vConfig.streamElements}&text=${encoded}`,
      `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${vConfig.google}&client=tw-ob&q=${encoded}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${vConfig.google}&client=tw-ob&q=${encoded}`)}`
    ];

    let success = false;
    for (const url of apis) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 1000) { 
            audioBuffers.push(buf);
            success = true;
            break; 
          }
        }
      } catch (e) {
        continue; 
      }
    }
    if (!success) throw new Error("Fallo de red en TTS.");
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

// ... Mantén debajo la función generateViralMusic() exactamente igual que antes ...
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
  const numOfChan = renderedBuffer.numberOfChannels;
  const length = renderedBuffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  let pos = 0;
  const writeString = (str: string) => { for (let i = 0; i < str.length; i++) out.setUint8(pos++, str.charCodeAt(i)); };
  writeString("RIFF"); out.setUint32(pos, length - 8, true); pos += 4;
  writeString("WAVE"); writeString("fmt "); out.setUint32(pos, 16, true); pos += 4;
  out.setUint16(pos, 1, true); pos += 2; out.setUint16(pos, numOfChan, true); pos += 2;
  out.setUint32(pos, renderedBuffer.sampleRate, true); pos += 4;
  out.setUint32(pos, renderedBuffer.sampleRate * 2 * numOfChan, true); pos += 4;
  out.setUint16(pos, numOfChan * 2, true); pos += 2; out.setUint16(pos, 16, true); pos += 2;
  writeString("data"); out.setUint32(pos, length - pos - 4, true); pos += 4;
  const channel = renderedBuffer.getChannelData(0);
  let offset = 0;
  while (offset < renderedBuffer.length) {
    let sample = Math.max(-1, Math.min(1, channel[offset]));
    sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
    out.setInt16(pos, sample, true); pos += 2; offset++;
  }
  return new Blob([out], { type: "audio/wav" });
}
