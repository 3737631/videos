export interface SpeechResult {
  audioBlob: Blob;
  wordChunks: string[];
}

function cleanScript(text: string): string {
  // Mantiene letras, números, puntuación básica y ESPACIOS
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\p{L}\p{N}\s.,!?¿¡'’"-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createWordChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  // Agrupa de 1 a 2 palabras para asegurar que quepan en el formato vertical
  for (let i = 0; i < words.length; i += 2) {
    const chunk = words.slice(i, i + 2).join(" ");
    if (chunk) {
      chunks.push(chunk.toUpperCase());
    }
  }

  return chunks;
}

export async function generateSpeechAndCues(
  text: string,
  lang = "es"
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);

  if (!cleanText) {
    throw new Error("El guion está vacío tras la limpieza.");
  }

  const limitedText = cleanText.length > 250 ? `${cleanText.slice(0, 247).trim()}...` : cleanText;
  const wordChunks = createWordChunks(limitedText);

  if (wordChunks.length === 0) {
    throw new Error("No se encontraron palabras válidas en el guion.");
  }

  const SE_VOICES: Record<string, string> = {
    es: "Mia",
    en: "Brian",
    pt: "Vitoria",
    fr: "Celine"
  };
  
  const voice = SE_VOICES[lang] || "Mia";
  const encodedText = encodeURIComponent(limitedText);
  const googleTtsUrl = encodeURIComponent(`https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`);

  // Red de APIs exclusivas para FrontEnd (GitHub Pages compatible, con CORS abierto)
  const urls = [
    `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}`, // API Directa
    `https://api.allorigins.win/raw?url=${googleTtsUrl}`, // Proxy AllOrigins
    `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`, // Proxy CorsProxy
    `https://api.codetabs.com/v1/proxy?quest=https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}` // Proxy CodeTabs
  ];

  let audioBlob: Blob | null = null;

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 segundos máximo por intento

      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timeoutId);

      if (response.ok) {
        const blob = await response.blob();
        // Solo aceptamos blobs válidos (más de 200 bytes, para ignorar errores HTML camuflados)
        if (blob.size > 200) {
          audioBlob = blob;
          break; 
        }
      }
    } catch (e) {
      continue; // Si falla por AdBlock o error de red, prueba el siguiente proxy
    }
  }

  // CERO PITIDOS: Si todas las redes fallan, mostramos el error real en pantalla
  if (!audioBlob) {
    throw new Error("Todas las conexiones de voz fueron bloqueadas. Por favor, pausa tu AdBlocker o revisa tu conexión a internet.");
  }

  // Verificación estricta: Comprobar que el navegador es capaz de decodificar el audio antes de renderizar
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("Tu navegador no soporta AudioContext.");

    const audioContext = new AudioContextClass();
    const buffer = await audioBlob.arrayBuffer();
    
    await new Promise<AudioBuffer>((resolve, reject) => {
      audioContext.decodeAudioData(buffer.slice(0), resolve, reject);
    });
    
    await audioContext.close().catch(() => {});
  } catch (e) {
    throw new Error("La voz se descargó, pero el archivo está corrupto o el navegador no puede procesarlo.");
  }

  return { audioBlob, wordChunks };
}

// Generador de base musical para modo "Music" (Este usa OfflineAudioContext local, no requiere internet)
export async function generateViralMusic(duration: number): Promise<Blob> {
  const safeDuration = Math.max(1, Math.min(60, duration));
  const sampleRate = 44100;
  const renderDuration = safeDuration + 0.5;

  const AudioContextConstructor = window.OfflineAudioContext || (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!AudioContextConstructor) throw new Error("Tu navegador no soporta generación de audio.");

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
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset++, value.charCodeAt(i));
    }
  };

  writeString("RIFF"); view.setUint32(offset, totalLength - 8, true); offset += 4;
  writeString("WAVE"); writeString("fmt "); view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2; view.setUint16(offset, numberOfChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4; view.setUint32(offset, sampleRate * numberOfChannels * 2, true); offset += 4;
  view.setUint16(offset, numberOfChannels * 2, true); offset += 2; view.setUint16(offset, bitsPerSample, true); offset += 2;
  writeString("data"); view.setUint32(offset, dataLength, true); offset += 4;

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel++) {
    channels.push(buffer.getChannelData(channel));
  }

  for (let sample = 0; sample < buffer.length; sample++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      let value = channels[channel][sample];
      value = Math.max(-1, Math.min(1, value));
      const intValue = value < 0 ? value * 0x8000 : value * 0x7fff;
      view.setInt16(offset, intValue, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}
