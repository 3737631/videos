export async function generateSpeechAndCues(
  text: string,
  lang: string = "es",
  targetDurationSec: number = 10
): Promise<{ audioBlob: Blob; wordChunks: string[] }> {
  
  const cleanText = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑçãõâêîôûàèìòù.,!¿?'-]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) {
    rawWords.push("Increíble", "descúbrelo", "ahora");
  }

  const wordChunks: string[] = [];
  for (let i = 0; i < rawWords.length; i += 2) {
    wordChunks.push(rawWords.slice(i, i + 2).join(" "));
  }

  let finalAudioBlob: Blob | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, lang }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 500) {
        finalAudioBlob = new Blob([buf], { type: 'audio/mp3' });
      }
    }
  } catch (e) {
    console.warn("Proxy TTS failed, trying direct fallback:", e);
  }

  // Respaldo directo si el servidor intermedio falla
  if (!finalAudioBlob) {
    try {
      const directUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Mia&text=${encodeURIComponent(cleanText)}`;
      const dRes = await fetch(directUrl);
      if (dRes.ok) {
        const buf = await dRes.arrayBuffer();
        if (buf.byteLength > 500) {
          finalAudioBlob = new Blob([buf], { type: 'audio/mp3' });
        }
      }
    } catch (e) {}
  }

  // Respaldo rítmico definitivo (pulsos de voz simulados, cero pitidos continuos)
  if (!finalAudioBlob) {
    finalAudioBlob = await generateRhythmicVoice(rawWords, Math.max(8, targetDurationSec));
  }

  return { audioBlob: finalAudioBlob, wordChunks };
}

async function generateRhythmicVoice(words: string[], targetDuration: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const offlineCtx = new AC(1, sampleRate * targetDuration, sampleRate);
  
  const timePerWord = targetDuration / Math.max(1, words.length);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const start = i * timePerWord;
    const dur = Math.min(timePerWord * 0.8, 0.3);
    
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.frequency.setValueAtTime(250 + (word.length * 35), start);
    osc.type = "sawtooth";
    
    const filter = offlineCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offlineCtx.destination);
    
    osc.start(start);
    osc.stop(start + dur);
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
    out.setInt16(pos, sample, true); pos += 2;
    offset++;
  }
  return new Blob([out], { type: "audio/wav" });
}
