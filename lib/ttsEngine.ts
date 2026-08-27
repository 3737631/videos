export async function generateSpeechAndCues(
  text: string,
  lang: string = "es",
  targetDurationSec: number = 10
): Promise<{ audioBlob: Blob; wordChunks: string[] }> {
  
  const cleanText = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑçãõâêîôûàèìòù.,!¿?'-]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) {
    rawWords.push("¡INCREÍBLE!", "DESCÚBRELO", "AHORA");
  }

  // Subtítulos ultra dinámicos en mayúsculas (de 1 a 2 palabras para estilo TikTok)
  const wordChunks: string[] = [];
  for (let i = 0; i < rawWords.length; i += 2) {
    wordChunks.push(rawWords.slice(i, i + 2).join(" ").toUpperCase());
  }

  const voiceMap: Record<string, { streamElements: string, google: string }> = {
    es: { streamElements: "Mia", google: "es-ES" },
    en: { streamElements: "Brian", google: "en-US" },
    pt: { streamElements: "Vitoria", google: "pt-BR" },
    fr: { streamElements: "Celine", google: "fr-FR" }
  };
  const v = voiceMap[lang] || voiceMap["es"];
  const encoded = encodeURIComponent(cleanText);

  // SISTEMA DE CAPAS INMUNE A ADBLOCKERS
  const apis = [
    '/api/tts', // Servidor interno Next.js (imposible de bloquear por adblockers de cliente)
    `https://api.streamelements.com/kappa/v2/speech?voice=${v.streamElements}&text=${encoded}`,
    `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${v.google}&client=tw-ob&q=${encoded}`,
    `https://corsproxy.io/?https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${v.google}&client=tw-ob&q=${encoded}`
  ];

  let audioBlob: Blob | null = null;

  for (const url of apis) {
    try {
      let res;
      if (url === '/api/tts') {
        res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText, lang })
        });
      } else {
        res = await fetch(url, { cache: "no-store" });
      }

      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 500) {
          audioBlob = blob;
          break; 
        }
      }
    } catch (e) {
      continue; 
    }
  }

  // Respaldo armónico si fallaran las redes
  if (!audioBlob) {
    audioBlob = await generateHarmonicSynth(Math.max(8, targetDurationSec));
  }

  return { audioBlob, wordChunks };
}

async function generateHarmonicSynth(durationSec: number): Promise<Blob> {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 44100 * durationSec, 44100);
  
  const notes = [261.63, 329.63, 392.00, 523.25];
  const beat = 0.5;
  for (let t = 0; t < durationSec; t += beat) {
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.type = "triangle";
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
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 44100 * (duration + 2), 44100);
  const bpm = 120;
  const beatTime = 60 / bpm; 
  
  for (let i = 0; i < duration + 2; i += beatTime) {
    const kick = offlineCtx.createOscillator();
    const kickGain = offlineCtx.createGain();
    kick.frequency.setValueAtTime(120, i);
    kick.frequency.exponentialRampToValueAtTime(0.01, i + 0.3);
    kickGain.gain.setValueAtTime(0.8, i);
    kickGain.gain.exponentialRampToValueAtTime(0.01, i + 0.3);
    kick.connect(kickGain);
    kickGain.connect(offlineCtx.destination);
    kick.start(i);
    kick.stop(i + 0.3);
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
