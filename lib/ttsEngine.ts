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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function base64ToBlob(dataURI: string): Blob {
  const parts = dataURI.split(',');
  const byteString = atob(parts[1]);
  const mimeString = parts[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: mimeString });
}

// Fallback robusto offline
async function generateAnimaleseVoice(text: string, ctx: AudioContext): Promise<AudioBuffer> {
  try {
    const chars = text.split('');
    const charDuration = 0.06;
    const totalDuration = chars.length * charDuration + 0.5;

    const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado");
    const sampleRate = ctx.sampleRate || 44100;
    const offlineCtx = new OfflineAudioContextClass(1, Math.ceil(sampleRate * totalDuration), sampleRate);
    let currentTime = 0;

    for (const char of chars) {
      if (char === ' ') {
        currentTime += charDuration * 1.5;
        continue;
      }
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      const filter = offlineCtx.createBiquadFilter();

      osc.type = "square";
      const charCode = char.toLowerCase().charCodeAt(0) || 97;
      const isVowel = ['a','e','i','o','u'].includes(char.toLowerCase());
      
      let baseFreq = 300 + ((charCode % 26) * 15);
      if (isVowel) baseFreq += 150;

      osc.frequency.setValueAtTime(baseFreq, currentTime);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, currentTime + charDuration);

      filter.type = "bandpass";
      filter.frequency.value = 1500;
      filter.Q.value = 1.5;

      gain.gain.setValueAtTime(0, currentTime);
      gain.gain.linearRampToValueAtTime(0.15, currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, currentTime + charDuration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(offlineCtx.destination);

      osc.start(currentTime);
      osc.stop(currentTime + charDuration);
      currentTime += charDuration;
    }
    return await offlineCtx.startRendering();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error("El generador de voz Offline falló: " + msg);
  }
}

async function fetchTTSBuffer(text: string, lang: string, ctx: AudioContext, onStatus?: (msg: string) => void): Promise<AudioBuffer> {
  const SE_VOICES: Record<string, string> = { es: "Mia", en: "Brian", pt: "Vitoria", fr: "Celine" };
  const voice = SE_VOICES[lang] || "Mia";
  
  const encodedText = encodeURIComponent(text);
  // Formato limpio sin doble encode inicial
  const googleTtsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`;

  const pasarelas = [
    { name: "StreamElements", url: `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}` },
    { name: "CorsProxy", url: `https://corsproxy.io/?${encodeURIComponent(googleTtsUrl)}` },
    { name: "AllOrigins", url: `https://api.allorigins.win/get?url=${encodeURIComponent(googleTtsUrl)}` }
  ];

  for (let i = 0; i < pasarelas.length; i++) {
    const { name, url } = pasarelas[i];
    if (onStatus) onStatus(`Probando pasarela ${i+1}/3 (${name})...`);

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6000); // 6s estricto
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(id);

      if (!res.ok) continue;

      let arrayBuffer: ArrayBuffer;

      if (name === "AllOrigins") {
        const json = await res.json();
        if (!json.contents || !json.contents.includes("audio")) continue; // Protege de HTML camuflado en JSON
        const base64 = json.contents.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        arrayBuffer = bytes.buffer;
      } else {
        const blob = await res.blob();
        const type = blob.type.toLowerCase();
        // Validación estricta anti-HTML de error
        if (blob.size < 200 || type.includes("text") || type.includes("html") || type.includes("json")) {
          continue; 
        }
        arrayBuffer = await blob.arrayBuffer();
      }

      // PRUEBA DE FUEGO: Decodificación inmediata. Si falla, el catch lo atrapa y pasa al siguiente proxy
      const decodedBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        // Hacemos slice(0) para no bloquear el ArrayBuffer original si falla
        ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      });

      return decodedBuffer; // Éxito total
    } catch (e) {
      console.warn(`[TTS] Pasarela ${name} falló:`, e);
      continue;
    }
  }

  throw new Error("Todas las pasarelas de red bloqueadas.");
}

export async function generateSpeechAndCues(
  text: string,
  lang: string,
  sharedCtx: AudioContext,
  onStatus?: (msg: string) => void
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);
  if (!cleanText) throw new Error("El guion generado está vacío.");

  const limitedText = cleanText.length > 250 ? `${cleanText.slice(0, 247).trim()}...` : cleanText;
  const wordChunks = createWordChunks(limitedText);
  if (wordChunks.length === 0) throw new Error("No se encontraron palabras válidas.");

  const textChunks = splitIntoShortSentences(limitedText, 120); 
  let totalDuration = 0;
  const decodedBuffers: AudioBuffer[] = [];

  try {
    for (const [index, tChunk] of textChunks.entries()) {
      if (onStatus) onStatus(`Descargando bloque de voz ${index + 1}/${textChunks.length}...`);
      const buffer = await fetchTTSBuffer(tChunk, lang, sharedCtx, onStatus);
      decodedBuffers.push(buffer);
      totalDuration += buffer.duration;
    }
  } catch (error) {
    if (onStatus) onStatus(`Red bloqueada. Activando voz local de emergencia...`);
    console.warn("Iniciando fallback Animalese:", error);
    const fallbackBuffer = await generateAnimaleseVoice(limitedText, sharedCtx);
    return { audioBuffer: fallbackBuffer, wordChunks };
  }

  if (onStatus) onStatus("Ensamblando audio final...");
  const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado");
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

  const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
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

  return await offlineCtx.startRendering();
}
