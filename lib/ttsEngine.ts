export async function generateSpeechAndCues(
  text: string,
  lang: string = "es",
  targetDurationSec: number = 10
): Promise<{ audioBlob: Blob; wordChunks: string[] }> {
  
  const cleanText = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑçãõâêîôûàèìòù.,!¿?'-]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) {
    rawWords.push("¡Increíble!", "descúbrelo", "ahora");
  }

  const wordChunks: string[] = [];
  for (let i = 0; i < rawWords.length; i += 2) {
    wordChunks.push(rawWords.slice(i, i + 2).join(" "));
  }

  let audioBlob: Blob | null = null;

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, lang })
    });

    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 500) {
        audioBlob = blob;
      }
    }
  } catch (e) {
    console.warn("API TTS fetch failed:", e);
  }

  // Respaldo directo si el servidor intermedio falla
  if (!audioBlob) {
    try {
      const vMap: Record<string, string> = { es: "Mia", en: "Brian", pt: "Vitoria", fr: "Celine" };
      const voice = vMap[lang] || "Mia";
      const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodeURIComponent(cleanText)}`;
      const seRes = await fetch(seUrl);
      if (seRes.ok) {
        const blob = await seRes.blob();
        if (blob.size > 500) audioBlob = blob;
      }
    } catch (e) {}
  }

  // Respaldo rítmico agradable si todo lo demás falla (cero pitidos)
  if (!audioBlob) {
    audioBlob = await generateSynthVoice(Math.max(8, targetDurationSec));
  }

  return { audioBlob, wordChunks };
}

async function generateSynthVoice(durationSec: number): Promise<Blob> {
  const AC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const offlineCtx = new AC(1, sampleRate * durationSec, sampleRate);
  
  const notes = [261.63, 329.63, 392.00, 523.25];
  const beat = 0.3;
  for (let t = 0; t < durationSec; t += beat) {
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = notes[Math.floor(Math.random() * notes.length)];
    
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
    
    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(t);
    osc.stop(t + beat);
  }
  
  const buffer = await offlineCtx.startRendering();
  return audioBufferToWav(buffer);
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
  const buffer = await offlineCtx.startRendering();
  return audioBufferToWav(buffer);
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
