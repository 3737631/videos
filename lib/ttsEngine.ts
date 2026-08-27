export interface SpeechResult {
  audioBlob: Blob;
  wordChunks: string[];
}

function cleanScript(text: string): string {
  // Limpieza estricta conservando espacios y caracteres válidos
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\p{L}\p{N}\s.,!?¿¡'’"-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createWordChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  // Agrupa máximo 2 palabras para que siempre quepan en formato TikTok (270px ancho)
  for (let i = 0; i < words.length; i += 2) {
    const chunk = words.slice(i, i + 2).join(" ");
    if (chunk) chunks.push(chunk.toUpperCase());
  }
  return chunks;
}

// Trocea el texto en fragmentos cortos para que las APIs gratuitas no rechacen la petición
function splitIntoShortSentences(text: string, maxLength: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const word of words) {
    if ((currentChunk + " " + word).trim().length <= maxLength) {
      currentChunk = (currentChunk + " " + word).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = word;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

function base64ToBlob(dataURI: string): Blob {
  const parts = dataURI.split(',');
  const byteString = atob(parts[1]);
  const mimeString = parts[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: mimeString });
}

// Descargador blindado con 4 pasarelas distintas (Anti-AdBlockers y Anti-RateLimits)
async function fetchTTSBlobWithFallbacks(text: string, lang: string): Promise<Blob> {
  const encodedText = encodeURIComponent(text);
  const SE_VOICES: Record<string, string> = { es: "Mia", en: "Brian", pt: "Vitoria", fr: "Celine" };
  const voice = SE_VOICES[lang] || "Mia";
  
  const googleTtsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`;
  const rvLang = lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : lang === 'pt' ? 'pt-BR' : 'fr-FR';

  const urls = [
    `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}`, // 1. Alta calidad (Polly)
    `https://code.responsivevoice.org/getvoice.php?t=${encodedText}&tl=${rvLang}&sv=&vn=&pitch=0.5&rate=0.5&vol=1`, // 2. Respaldo oficial con CORS abierto
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(googleTtsUrl)}`, // 3. Proxy a Google
    `https://api.allorigins.win/get?url=${encodeURIComponent(googleTtsUrl)}` // 4. Proxy de emergencia (base64)
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 10000); // 10s máximo por intento
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(id);

      if (!res.ok) continue;

      if (url.includes("allorigins.win/get")) {
        const json = await res.json();
        if (json.contents && json.contents.startsWith("data:audio")) {
          return base64ToBlob(json.contents);
        }
        continue;
      }

      const blob = await res.blob();
      if (blob.size > 200) return blob; // Audio válido
    } catch {
      continue; // Pasa a la siguiente pasarela si falla
    }
  }
  throw new Error(`Fallo al descargar la voz para: "${text.substring(0, 20)}...". Comprueba tu conexión o pausa tu AdBlocker.`);
}

export async function generateSpeechAndCues(
  text: string,
  lang = "es"
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);

  if (!cleanText) {
    throw new Error("El guion está vacío.");
  }

  const wordChunks = createWordChunks(cleanText);
  const textChunks = splitIntoShortSentences(cleanText, 150); // Troceado inteligente

  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("AudioContext no soportado en tu navegador.");
  
  const ctx = new AudioContextClass();
  let totalDuration = 0;
  const decodedBuffers: AudioBuffer[] = [];

  // Descarga y une cada frase
  for (const tChunk of textChunks) {
    const blob = await fetchTTSBlobWithFallbacks(tChunk, lang);
    const arrayBuffer = await blob.arrayBuffer();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      decodedBuffers.push(decoded);
      totalDuration += decoded.duration;
    } catch {
      throw new Error("El archivo de voz descargado está corrupto. Intenta de nuevo.");
    }
  }

  // Mezcla de todas las frases en una sola pista fluida
  const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const offlineCtx = new OfflineAudioContextClass(1, Math.max(1, Math.ceil(ctx.sampleRate * totalDuration)), ctx.sampleRate);
  
  let currentTime = 0;
  for (const buf of decodedBuffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buf;
    source.connect(offlineCtx.destination);
    source.start(currentTime);
    currentTime += buf.duration;
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const finalWavBlob = audioBufferToWav(renderedBuffer);

  return { audioBlob: finalWavBlob, wordChunks };
}

// Generador de música (Local, NO depende de internet)
export async function generateViralMusic(duration: number): Promise<Blob> {
  const safeDuration = Math.max(1, Math.min(60, duration));
  const sampleRate = 44100;
  const renderDuration = safeDuration + 0.5;

  const AudioContextConstructor = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
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
