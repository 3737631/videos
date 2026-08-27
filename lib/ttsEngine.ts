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
  // Agrupamos en 1 o 2 palabras máximo para formato TikTok (vertical)
  for (let i = 0; i < words.length; i += 2) {
    const chunk = words.slice(i, i + 2).join(" ");
    if (chunk) chunks.push(chunk.toUpperCase());
  }
  return chunks;
}

// ============================================================================
// FALLBACK INVENCIBLE: Generador de voz estilo Animal Crossing (Local / Offline)
// ============================================================================
async function generateAnimaleseVoice(text: string, ctx: AudioContext): Promise<AudioBuffer> {
  const chars = text.split('');
  const charDuration = 0.06; // Velocidad rápida
  const totalDuration = chars.length * charDuration + 0.5;

  const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado");
  const offlineCtx = new OfflineAudioContextClass(1, Math.ceil(ctx.sampleRate * totalDuration), ctx.sampleRate);
  let currentTime = 0;

  for (const char of chars) {
    if (char === ' ') {
      currentTime += charDuration * 1.5;
      continue;
    }

    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    const filter = offlineCtx.createBiquadFilter();

    osc.type = "square"; // Sonido retro clásico

    const charCode = char.toLowerCase().charCodeAt(0);
    const isVowel = ['a','e','i','o','u'].includes(char.toLowerCase());
    
    // Tono dinámico basado en la letra
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
}

// ============================================================================
// GENERADOR PRINCIPAL DE VOZ (Intenta APIs, si fallan usa Animal Crossing)
// ============================================================================
export async function generateSpeechAndCues(
  text: string,
  lang: string,
  sharedCtx: AudioContext // El contexto VIVO pasado desde el clic del botón
): Promise<SpeechResult> {
  const cleanText = cleanScript(text);

  if (!cleanText) throw new Error("El guion está vacío.");

  const limitedText = cleanText.length > 250 ? `${cleanText.slice(0, 247).trim()}...` : cleanText;
  const wordChunks = createWordChunks(limitedText);

  if (wordChunks.length === 0) throw new Error("No hay palabras en el guion.");

  const SE_VOICES: Record<string, string> = { es: "Mia", en: "Brian", pt: "Vitoria", fr: "Celine" };
  const voice = SE_VOICES[lang] || "Mia";
  const encodedText = encodeURIComponent(limitedText);
  const googleUrl = encodeURIComponent(`https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${lang}&q=${encodedText}`);

  const urls = [
    `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodedText}`,
    `https://api.allorigins.win/get?url=${googleUrl}`
  ];

  let audioBuffer: AudioBuffer | null = null;

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6000); // 6s máximo para que no parezca colgado
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(id);

      if (!res.ok) continue;

      let arrayBuffer: ArrayBuffer;

      if (url.includes("allorigins")) {
        const json = await res.json();
        if (!json.contents || !json.contents.includes("audio")) continue; // Falso positivo
        const base64 = json.contents.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        arrayBuffer = bytes.buffer;
      } else {
        const blob = await res.blob();
        if (blob.size < 200 || blob.type.includes("html")) continue; 
        arrayBuffer = await blob.arrayBuffer();
      }

      // Decodifica usando el contexto VIVO. Jamás se congelará.
      audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        sharedCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      });
      break; 
    } catch {
      continue;
    }
  }

  // Si todas las conexiones de voz fueron bloqueadas, entra el FALLBACK ANIMAL CROSSING
  if (!audioBuffer) {
    audioBuffer = await generateAnimaleseVoice(limitedText, sharedCtx);
  }

  return { audioBuffer, wordChunks };
}

export async function generateViralMusic(duration: number): Promise<AudioBuffer> {
  const safeDuration = Math.max(1, Math.min(60, duration));
  const sampleRate = 44100;
  const renderDuration = safeDuration + 0.5;

  const OfflineAudioContextClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) throw new Error("Audio Offline no soportado");
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
