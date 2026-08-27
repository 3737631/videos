export interface SpeechResult {
  audioBuffer: AudioBuffer;
  wordChunks: string[];
  isFallback: boolean;
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

// Voz local viral típica - aguda y enérgica
async function generateAnimaleseVoice(text: string, ctx: AudioContext): Promise<AudioBuffer> {
  try {
    const chars = text.split('');
    const charDuration = 0.042;
    const totalDuration = Math.max(0.85, chars.length * charDuration + 0.30);
    const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado");
    const sampleRate = ctx.sampleRate || 44100;
    const offlineCtx = new OfflineAudioContextClass(1, Math.ceil(sampleRate * totalDuration), sampleRate);
    let currentTime = 0;
    for (const char of chars) {
      if (char === ' ') {
        currentTime += charDuration * 0.9;
        continue;
      }
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      const filter = offlineCtx.createBiquadFilter();
      osc.type = "triangle";
      const code = char.toLowerCase().charCodeAt(0) || 97;
      const isVowel = "aeiouáéíóú".includes(char.toLowerCase());
      let baseFreq = 225 + ((code % 10) * 9);
      if (isVowel) baseFreq += 22;
      if (/[,.!?]/.test(char)) {
        currentTime += charDuration * 0.5;
        continue;
      }
      osc.frequency.setValueAtTime(baseFreq, currentTime);
      filter.type = "bandpass";
      filter.frequency.value = 1850;
      filter.Q.value = 1.1;
      gain.gain.setValueAtTime(0, currentTime);
      gain.gain.linearRampToValueAtTime(0.11, currentTime + 0.008);
      gain.gain.linearRampToValueAtTime(0.11, currentTime + charDuration * 0.6);
      gain.gain.linearRampToValueAtTime(0, currentTime + charDuration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(offlineCtx.destination);
      osc.start(currentTime);
      osc.stop(currentTime + charDuration);
      currentTime += charDuration * 0.92;
    }
    return await offlineCtx.startRendering();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error("Voz offline falló: " + msg);
  }
}

async function fetchTTSBuffer(text: string, lang: string, ctx: AudioContext, onStatus?: (msg: string) => void): Promise<AudioBuffer> {
  const SE_VOICES: Record<string, string> = { es: "Lucia", en: "Brian", pt: "Vitoria", fr: "Celine" };
  const voice = SE_VOICES[lang] || "Lucia";
  const rvMap: Record<string, string> = { es: "Spanish Female", en: "UK English Female", pt: "Portuguese Female", fr: "French Female" };
  const rvVoice = rvMap[lang] || "Spanish Female";
  const encodedText = encodeURIComponent(text);
  const googleTtsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`;
  // 4 pasarelas: SE (calidad), ResponsiveVoice viral rápida, CorsProxy, AllOrigins
  const pasarelas: { name: string; url: string }[] = [
    { name: "StreamElements", url: `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}` },
    { name: "ResponsiveVoice", url: `https://code.responsivevoice.org/getvoice.php?t=${encodedText}&tl=${lang}&sv=g2&vn=${encodeURIComponent(rvVoice)}&pitch=0.5&rate=0.92&vol=1` },
    { name: "CorsProxy", url: `https://corsproxy.io/?${encodeURIComponent(googleTtsUrl)}` },
    { name: "AllOrigins", url: `https://api.allorigins.win/get?url=${encodeURIComponent(googleTtsUrl)}` },
  ];

  for (let i = 0; i < pasarelas.length; i++) {
    const { name, url } = pasarelas[i];
    if (onStatus) onStatus(`Probando voz ${i + 1}/4 (${name})...`);
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6500);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(id);
      if (!res.ok) {
        console.warn(`[TTS] ${name} status ${res.status}`);
        continue;
      }
      let arrayBuffer: ArrayBuffer;
      if (name === "AllOrigins") {
        const json = await res.json();
        if (!json.contents || typeof json.contents !== "string" || !json.contents.includes("base64") && !json.contents.includes("audio")) {
          console.warn(`[TTS] ${name} sin audio`);
          continue;
        }
        // AllOrigins devuelve data:audio/mp3;base64,xxxxx
        const commaIdx = json.contents.indexOf(",");
        if (commaIdx === -1) continue;
        const base64 = json.contents.slice(commaIdx + 1);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        arrayBuffer = bytes.buffer;
      } else {
        const blob = await res.blob();
        const type = (blob.type || "").toLowerCase();
        if (blob.size < 180 || type.includes("text/html") || type.includes("text/plain") && blob.size < 800) {
          console.warn(`[TTS] ${name} bloqueado tipo=${type} size=${blob.size}`);
          continue;
        }
        if (type.includes("json") && blob.size < 2000) {
          const txt = await blob.text();
          if (txt.includes("<html") || txt.includes("error") || txt.includes("blocked")) continue;
          // si es json pero parece audio falló
        }
        arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength < 180) continue;
      }
      // Decodifica con contexto vivo
      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      });
      if (decoded.duration < 0.15) {
        console.warn(`[TTS] ${name} duración muy corta ${decoded.duration}`);
        continue;
      }
      console.log(`[TTS] OK ${name} dur=${decoded.duration.toFixed(2)}`);
      return decoded;
    } catch (e) {
      console.warn(`[TTS] ${name} excepción`, e);
      continue;
    }
  }
  throw new Error("Red bloqueada por AdBlock/CORS");
}

export async function generateSpeechAndCues(
  text: string,
  lang: string,
  sharedCtx: AudioContext,
  onStatus?: (msg: string) => void
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);
  if (!cleanText) throw new Error("El guion generado está vacío.");
  // Texto más largo para viral 9-10s: 280 chars en vez de 220
  const limitedText = cleanText.length > 280 ? `${cleanText.slice(0, 277).trim()}...` : cleanText;
  const wordChunks = createWordChunks(limitedText);
  if (wordChunks.length === 0) throw new Error("No se encontraron palabras válidas.");
  const textChunks = splitIntoShortSentences(limitedText, 110);
  let totalDuration = 0;
  const decodedBuffers: AudioBuffer[] = [];
  let usedFallback = false;
  let anyRealVoice = false;

  for (const [index, tChunk] of textChunks.entries()) {
    if (onStatus) onStatus(`Generando voz ${index + 1}/${textChunks.length}...`);
    try {
      const buf = await fetchTTSBuffer(tChunk, lang, sharedCtx, onStatus);
      decodedBuffers.push(buf);
      totalDuration += buf.duration;
      anyRealVoice = true;
    } catch (chunkErr) {
      console.warn(`[TTS] chunk ${index + 1} fallback local`, chunkErr);
      const fallbackChunk = await generateAnimaleseVoice(tChunk, sharedCtx);
      decodedBuffers.push(fallbackChunk);
      totalDuration += fallbackChunk.duration;
      usedFallback = true;
    }
  }

  if (decodedBuffers.length === 0) {
    throw new Error("No se pudo generar audio");
  }

  // Si todo fue fallback, avisar, si fue mixto también marcar
  const isFallback = usedFallback && !anyRealVoice ? true : usedFallback;

  if (onStatus) onStatus(isFallback && !anyRealVoice ? "Voz local (AdBlock activo)..." : "Mezclando voz...");
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
  // Validar duración mínima real
  if (finalBuffer.duration < 0.5) throw new Error("Audio generado demasiado corto");
  return { audioBuffer: finalBuffer, wordChunks, isFallback };
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
