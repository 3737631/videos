export async function generateSpeechAndCues(
  text: string,
  lang: string = "es"
): Promise<{ audioBlob: Blob; wordChunks: string[] }> {
  
  const cleanText = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ.,!¿?'-]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) throw new Error("Guion vacío");

  // Agrupamos las palabras de 2 en 2 para que los subtítulos sean impactantes y se lean rápido
  const wordChunks: string[] = [];
  for (let i = 0; i < rawWords.length; i += 2) {
    wordChunks.push(rawWords.slice(i, i + 2).join(" "));
  }

  const voiceMap: Record<string, { streamElements: string, google: string }> = {
    es: { streamElements: "Mia", google: "es-ES" },
    en: { streamElements: "Brian", google: "en-US" },
  };
  const v = voiceMap[lang] || voiceMap["es"];

  // Dividimos en bloques seguros para no saturar la API
  const textChunks = cleanText.match(/.{1,150}(?:\s|$)/g) || [cleanText];
  const audioBuffers: ArrayBuffer[] = [];
  let success = true;

  for (const chunk of textChunks) {
    if (!chunk.trim()) continue;
    const encoded = encodeURIComponent(chunk.trim());
    const url1 = `https://api.streamelements.com/kappa/v2/speech?voice=${v.streamElements}&text=${encoded}`;
    const url2 = `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${v.google}&client=tw-ob&q=${encoded}`;

    let chunkSuccess = false;
    for (const url of [url1, url2]) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 1000) { 
            audioBuffers.push(buf);
            chunkSuccess = true;
            break; 
          }
        }
      } catch (e) { continue; }
    }
    
    if (!chunkSuccess) {
      success = false;
      break; 
    }
    await new Promise(r => setTimeout(r, 200)); 
  }

  let finalBlob: Blob;
  if (success && audioBuffers.length > 0) {
    const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of audioBuffers) {
      merged.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }
    finalBlob = new Blob([merged], { type: "audio/mp3" });
  } else {
    // SALVAVIDAS FINAL: Si te bloquean la IP, usa esto para que NUNCA falle el vídeo
    finalBlob = await generateOfflineVoice(rawWords.length);
  }

  return { audioBlob: finalBlob, wordChunks };
}

let finalAudioBlob: Blob; // internal use fallback

async function generateOfflineVoice(wordCount: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const duration = wordCount * 0.35; // Tiempo aprox por palabra
  const offlineCtx = new AC(1, 44100 * duration, 44100);
  
  for (let i = 0; i < wordCount; i++) {
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.frequency.value = 450; 
    osc.type = "sine"; 
    gain.gain.setValueAtTime(0.5, i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.01, (i * 0.35) + 0.3);
    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(i * 0.35);
    osc.stop((i * 0.35) + 0.35);
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
