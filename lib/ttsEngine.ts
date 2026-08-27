export interface SpeechResult {
  audioBlob: Blob;
  wordChunks: string[];
}

function cleanScript(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\p{L}\p{N}\s.,!?¿¡'’"-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createWordChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  
  // Agrupa máximo 2 palabras para garantizar que queden dentro del formato TikTok vertical (270px)
  for (let i = 0; i < words.length; i += 2) {
    const chunk = words.slice(i, i + 2).join(" ");
    if (chunk) chunks.push(chunk.toUpperCase());
  }
  return chunks;
}

export async function generateSpeechAndCues(
  text: string,
  lang = "es"
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);

  if (!cleanText) {
    throw new Error("El guion está vacío tras limpiarlo.");
  }

  // Límite estricto de 200 caracteres. Un solo bloque para evitar bloqueos por límite de peticiones (Rate-Limit 429)
  const limitedText = cleanText.length > 200 ? `${cleanText.slice(0, 197).trim()}...` : cleanText;
  const wordChunks = createWordChunks(limitedText);

  if (wordChunks.length === 0) {
    throw new Error("No se encontraron palabras válidas.");
  }

  const SE_VOICES: Record<string, string> = { es: "Mia", en: "Brian", pt: "Vitoria", fr: "Celine" };
  const voice = SE_VOICES[lang] || "Mia";
  const encodedText = encodeURIComponent(limitedText);
  const googleTtsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`;

  // Red de pasarelas con CORS abierto. El orden prioriza calidad y velocidad.
  const urls = [
    `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}`,
    `https://corsproxy.io/?${encodeURIComponent(googleTtsUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(googleTtsUrl)}`,
    `https://thingproxy.freeboard.io/fetch/${googleTtsUrl}`
  ];

  let validAudioBlob: Blob | null = null;
  
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("AudioContext no está soportado en este navegador.");
  const testCtx = new AudioContextClass();

  // Bucle a prueba de fallos y engaños HTML de los proxies
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 segundos por intento
      
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const blob = await res.blob();
      
      // Descartar inmediatamente si el proxy devolvió una web de error en vez de audio
      if (blob.type.includes("text") || blob.type.includes("html") || blob.type.includes("json")) {
        continue; 
      }

      const arrayBuffer = await blob.arrayBuffer();

      // PRUEBA DE FUEGO: Si decodeAudioData falla, el archivo está corrupto o es HTML camuflado.
      await new Promise<AudioBuffer>((resolve, reject) => {
        testCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      });

      // Si llegó hasta aquí, el audio es 100% válido y decodificable
      validAudioBlob = blob;
      break; 

    } catch {
      // El audio falló la validación o hubo timeout -> salta silenciosamente al siguiente
      continue;
    }
  }

  // Cierre de contexto de prueba
  await testCtx.close().catch(() => {});

  if (!validAudioBlob) {
    throw new Error("Los servidores de voz están bloqueados. Pausa tu AdBlocker o inténtalo en unos minutos.");
  }

  return { audioBlob: validAudioBlob, wordChunks };
}

// Generador Musical Offline (Funciona sin internet, no toca APIs externas)
export async function generateViralMusic(duration: number): Promise<Blob> {
  const safeDuration = Math.max(1, Math.min(60, duration));
  const sampleRate = 44100;
  const renderDuration = safeDuration + 0.5;

  const AudioContextConstructor = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!AudioContextConstructor) throw new Error("Tu navegador no soporta generación de audio offline.");

  const offlineCtx = new AudioContextConstructor(1, Math.ceil(sampleRate * renderDuration), sampleRate);
  const bpm = 112;
  const beat = 60 / bpm;

  for (let time = 0; time < renderDuration; time += beat) {
    const kick = offlineCtx.createOscillator();
    const kickGain = offlineCtx.createGain();
    kick.type = "sine";
    kick.frequency.setValueAtTime(130, time);
    kick.frequency.exponentialRampToValueAtTime(45, Math.min(time + 0.16, renderDuration));
    kickGain.gain.setValueAtTime(0.0001, time);
    kickGain.gain.exponentialRampToValueAtTime(0.45, Math.min(time + 0.005, renderDuration));
    kickGain.gain.exponentialRampToValueAtTime(0.0001, Math.min(time + 0.18, renderDuration));
    kick.connect(kickGain);
    kickGain.connect(offlineCtx.destination);
    kick.start(time);
    kick.stop(Math.min(time + 0.2, renderDuration));

    const hatTime = time + beat / 2;
    if (hatTime < renderDuration) {
      const hat = offlineCtx.createOscillator();
      const hatGain = offlineCtx.createGain();
      hat.type = "square";
      hat.frequency.setValueAtTime(6500, hatTime);
      hatGain.gain.setValueAtTime(0.0001, hatTime);
      hatGain.gain.exponentialRampToValueAtTime(0.035, Math.min(hatTime + 0.002, renderDuration));
      hatGain.gain.exponentialRampToValueAtTime(0.0001, Math.min(hatTime + 0.055, renderDuration));
      hat.connect(hatGain);
      hatGain.connect(offlineCtx.destination);
      hat.start(hatTime);
      hat.stop(Math.min(hatTime + 0.06, renderDuration));
    }

    if (Math.floor(time / beat) % 2 === 0) {
      const bass = offlineCtx.createOscillator();
      const bassGain = offlineCtx.createGain();
      bass.type = "triangle";
      bass.frequency.setValueAtTime(82.41, time);
      bassGain.gain.setValueAtTime(0.0001, time);
      bassGain.gain.exponentialRampToValueAtTime(0.08, Math.min(time + 0.015, renderDuration));
      bassGain.gain.exponentialRampToValueAtTime(0.0001, Math.min(time + 0.25, renderDuration));
      bass.connect(bassGain);
      bassGain.connect(offlineCtx.destination);
      bass.start(time);
      bass.stop(Math.min(time + 0.27, renderDuration));
    }
  }

  const buffer = await offlineCtx.startRendering();
  return audioBufferToWav(buffer);
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const dataLength = buffer.length * numberOfChannels * (bitsPerSample / 8);
  const totalLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i));
  };

  writeString("RIFF"); view.setUint32(offset, totalLength - 8, true); offset += 4;
  writeString("WAVE"); writeString("fmt "); view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2; view.setUint16(offset, numberOfChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4; view.setUint32(offset, sampleRate * numberOfChannels * 2, true); offset += 4;
  view.setUint16(offset, numberOfChannels * 2, true); offset += 2; view.setUint16(offset, bitsPerSample, true); offset += 2;
  writeString("data"); view.setUint32(offset, dataLength, true); offset += 4;

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel++) channels.push(buffer.getChannelData(channel));

  for (let sample = 0; sample < buffer.length; sample++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      let value = channels[channel][sample];
      value = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}
