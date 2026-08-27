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
  
  // Agrupamos de 2 en 2 para ritmo viral
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
  
  // VERSIÓN ESTABLE: Una sola petición con todo el texto. 
  // No satura el servidor, no da error y devuelve la voz humana perfecta.
  const encodedFull = encodeURIComponent(cleanText);
  const apis = [
    `https://api.streamelements.com/kappa/v2/speech?voice=${vConfig.streamElements}&text=${encodedFull}`,
    `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${vConfig.google}&client=tw-ob&q=${encodedFull}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${vConfig.google}&client=tw-ob&q=${encodedFull}`)}`
  ];

  let finalAudioBlob: Blob | null = null;

  for (const url of apis) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 1000) {
          finalAudioBlob = new Blob([buf], { type: "audio/mp3" });
          break; // Si tiene éxito, sale y usa esta voz
        }
      }
    } catch (e) {
      continue;
    }
  }

  // Salvavidas absoluto por si no hay internet
  if (!finalAudioBlob) {
    finalAudioBlob = await generateOfflineVoice(rawWords, targetDurationSec);
  }

  return { audioBlob: finalAudioBlob, cues };
}

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
