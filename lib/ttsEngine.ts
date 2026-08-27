import { CustomWindow } from "@/types";

export interface SpeechResult {
  audioBuffer: AudioBuffer;
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
  // Agrupamos en bloques de 1 a 2 palabras para que quepan centradas en 270px
  for (let i = 0; i < words.length; i += 2) {
    const chunk = words.slice(i, i + 2).join(" ");
    if (chunk) chunks.push(chunk.toUpperCase());
  }
  return chunks;
}

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

async function fetchTTSBufferWithFallbacks(text: string, lang: string, ctx: AudioContext): Promise<AudioBuffer> {
  const encodedText = encodeURIComponent(text);
  const SE_VOICES: Record<string, string> = { es: "Mia", en: "Brian", pt: "Vitoria", fr: "Celine" };
  const voice = SE_VOICES[lang] || "Mia";
  
  const googleTtsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`;

  // 3 Pasarelas 100% seguras y compatibles con GitHub Pages (CORS Abierto)
  const urls = [
    `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(googleTtsUrl)}`, // JSON proxy ultraseguro
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(googleTtsUrl)}`
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(id);

      if (!res.ok) continue;

      let arrayBuffer: ArrayBuffer;

      // Si usamos AllOrigins, decodificamos el JSON y extraemos el audio base64 puro
      if (url.includes("allorigins.win/get")) {
        const json = await res.json();
        if (!json.contents || !json.contents.includes("audio")) continue; // Falso positivo (HTML de error)
        
        const base64 = json.contents.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        arrayBuffer = bytes.buffer;
      } else {
        const blob = await res.blob();
        if (blob.size < 200 || blob.type.includes("text") || blob.type.includes("html")) continue; // Protege contra webs de error
        arrayBuffer = await blob.arrayBuffer();
      }

      // Validamos y decodificamos en el contexto activo
      return await ctx.decodeAudioData(arrayBuffer);

    } catch {
      continue; // Falla este proxy, pasa al siguiente
    }
  }

  throw new Error(`Los servidores de voz están saturados. Pausa el AdBlocker o reinténtalo en 1 minuto.`);
}

export async function generateSpeechAndCues(
  text: string,
  lang: string,
  sharedCtx: AudioContext
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);

  if (!cleanText) throw new Error("El guion está vacío.");

  const wordChunks = createWordChunks(cleanText);
  // Dividimos en frases muy cortas (120 caracteres) para que Google no nos bloquee
  const textChunks = splitIntoShortSentences(cleanText, 120); 

  let totalDuration = 0;
  const decodedBuffers: AudioBuffer[] = [];

  // Descargamos y verificamos cada fragmento
  for (const tChunk of textChunks) {
    const buffer = await fetchTTSBufferWithFallbacks(tChunk, lang, sharedCtx);
    decodedBuffers.push(buffer);
    totalDuration += buffer.duration;
  }

  // Mezclamos la voz en una pista maestra
  const win = window as CustomWindow;
  const OfflineAudioContextClass = window.OfflineAudioContext || win.webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado.");

  const offlineCtx = new OfflineAudioContextClass(1, Math.max(1, Math.ceil(sharedCtx.sampleRate * totalDuration)), sharedCtx.sampleRate);
  
  let currentTime = 0;
  for (const buf of decodedBuffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buf;
    source.connect(offlineCtx.destination);
    source.start(currentTime);
    currentTime += buf.duration;
  }

  const finalBuffer = await offlineCtx.startRendering();

  return { audioBuffer: finalBuffer, wordChunks };
}

export async function generateViralMusic(duration: number): Promise<AudioBuffer> {
  const safeDuration = Math.max(1, Math.min(60, duration));
  const sampleRate = 44100;
  const renderDuration = safeDuration + 0.5;

  const win = window as CustomWindow;
  const OfflineAudioContextClass = window.OfflineAudioContext || win.webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado.");

  const offlineCtx = new OfflineAudioContextClass(1, Math.ceil(sampleRate * renderDuration), sampleRate);
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

  // Devolvemos el AudioBuffer crudo, eliminando el fallo de conversión WAV
  return await offlineCtx.startRendering();
}
