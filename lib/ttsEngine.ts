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

  // Troceamos el guion en partes pequeñas de 150 caracteres para burlar todos los límites
  const textChunks = cleanText.match(/.{1,150}(?:\s|$)/g) || [cleanText];
  const audioBuffers: ArrayBuffer[] = [];

  for (const chunk of textChunks) {
    if (!chunk.trim()) continue;
    
    const t = encodeURIComponent(chunk.trim());
    let chunkBuffer: ArrayBuffer | null = null;

    // SISTEMA "HYDRA" DE 4 CAPAS ANTI-ADBLOCK
    // Si una falla, salta a la siguiente inmediatamente
    const attempts = [
      // INTENTO 1: Usar el Backend propio (100% Inmune a AdBlockers)
      async () => {
        const r = await fetch('/api/tts', { 
            method: 'POST', 
            body: JSON.stringify({ text: chunk.trim(), lang: 'es-ES' }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!r.ok) throw new Error();
        return await r.arrayBuffer();
      },
      // INTENTO 2: Amazon Polly vía StreamElements (Voz Femenina "Mia")
      async () => {
        const r = await fetch(`https://api.streamelements.com/kappa/v2/speech?voice=Mia&text=${t}`);
        if (!r.ok) throw new Error();
        return await r.arrayBuffer();
      },
      // INTENTO 3: Conexión directa a Google TTS
      async () => {
        const r = await fetch(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es-ES&client=tw-ob&q=${t}`);
        if (!r.ok) throw new Error();
        return await r.arrayBuffer();
      },
      // INTENTO 4: Proxy público CORS (Si el navegador prohíbe Google y StreamElements)
      async () => {
        const googleUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es-ES&client=tw-ob&q=${t}`;
        const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`);
        if (!r.ok) throw new Error();
        return await r.arrayBuffer();
      }
    ];

    for (const tryFetch of attempts) {
      try {
        chunkBuffer = await tryFetch();
        break; // Si consigue el audio, sale del bucle de intentos con éxito
      } catch (e) {
        continue; // Si el AdBlock lo bloqueó, pasa silenciosamente al siguiente
      }
    }

    if (chunkBuffer) {
      audioBuffers.push(chunkBuffer);
    } else {
      throw new Error("Imposible obtener voz. Revisa tu conexión a internet.");
    }
  }

  // Unimos todos los trozos humanos obtenidos
  const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of audioBuffers) {
    merged.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  return { audioBlob: new Blob([merged], { type: "audio/mp3" }), cues };
}


// --- MANTENEMOS LA MÚSICA LO-FI PARA EL MODO "SOLO MÚSICA" ---
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
  
  // Transformador WAV
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
