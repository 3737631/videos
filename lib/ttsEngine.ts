import { SubtitleCue } from "@/types";

export async function generateSpeechAndCues(
  text: string,
  targetDurationSec: number
): Promise<{ audioBlob: Blob; cues: SubtitleCue[] }> {
  
  // 1. Limpieza extrema del texto para que no haya caracteres que rompan la red
  const cleanText = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ.,!¿? ]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) throw new Error("Guion vacío");

  const timePerWord = targetDurationSec / rawWords.length;
  const cues: SubtitleCue[] = [];
  
  // 2. Sincronización de los subtítulos en pantalla
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

  // 3. Troceamos el guion en frases muy cortas para que se descarguen rapidísimo
  const textChunks = cleanText.match(/.{1,90}(?:\s|$)/g) || [cleanText];
  const audioBuffers: ArrayBuffer[] = [];

  for (const chunk of textChunks) {
    if (!chunk.trim()) continue;
    const encoded = encodeURIComponent(chunk.trim());
    
    // SISTEMA "DIOS": 6 Servidores diferentes. 
    // Si un AdBlocker bloquea uno, el sistema usa el siguiente de forma invisible.
    const apis = [
      `https://api.streamelements.com/kappa/v2/speech?voice=Mia&text=${encoded}`, // Servidor 1 (Amazon Polly)
      `https://texttospeech.responsivevoice.org/v1/text:synthesize?text=${encoded}&lang=es&engine=g3&name=&pitch=0.5&rate=0.5&vol=1&gender=female`, // Servidor 2 (ResponsiveVoice)
      `https://api.streamelements.com/kappa/v2/speech?voice=Conchita&text=${encoded}`, // Servidor 3 (Respaldo Amazon)
      `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es-ES&client=tw-ob&q=${encoded}`, // Servidor 4 (Google Cloud Proxy A)
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es-ES&client=tw-ob&q=${encoded}`)}`, // Servidor 5 (Google Cloud Proxy B)
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es-ES&client=tw-ob&q=${encoded}`)}` // Servidor 6 (Google Cloud Proxy C)
    ];

    let success = false;
    
    for (const url of apis) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 1000) { // Confirmamos que el archivo de audio es real y no un error vacío
            audioBuffers.push(buf);
            success = true;
            break; // ¡Exito! Salimos de la búsqueda y pasamos a la siguiente frase.
          }
        }
      } catch (e) {
        continue; // El navegador cortó la conexión. No pasa nada, saltamos al siguiente servidor en 0.01s.
      }
    }

    if (!success) {
      throw new Error("Tus bloqueadores de anuncios están cortando el internet. Desactiva el AdBlocker o el escudo de Brave para esta página.");
    }
  }

  // 4. Cosemos todos los audios descargados en un solo archivo MP3 maestro
  const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of audioBuffers) {
    merged.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  return { audioBlob: new Blob([merged], { type: "audio/mp3" }), cues };
}


// MANTENEMOS LA MÚSICA PHONK PARA EL MODO "SOLO MÚSICA"
export async function generateViralMusic(duration: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const offlineCtx = new AC(1, sampleRate * (duration + 2), sampleRate);
  
  const bpm = 120;
  const beatTime = 60 / bpm; 
  
  for (let i = 0; i < duration + 2; i += beatTime) {
    // Batería Electrónica
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
    
    // Platillos
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
    
    // Bajo
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
  
  // Transformador a WAV
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
