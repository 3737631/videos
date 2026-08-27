export async function generateSpeechAndCues(
  text: string,
  lang: string = "es"
): Promise<{ audioBlob: Blob; wordChunks: string[] }> {
  const cleanText = text
    .replace(
      /[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑçÇãõÃÕâêîôûÂÊÎÔÛàèìòùÀÈÌÒÙ.,!¿?¡:'"()\-_\s]/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    throw new Error("El guion generado está vacío.");
  }

  const rawWords = cleanText.split(/\s+/).filter(Boolean);

  if (!rawWords.length) {
    throw new Error("No se encontraron palabras válidas.");
  }

  const wordChunks: string[] = [];

  for (let i = 0; i < rawWords.length; i += 2) {
    wordChunks.push(
      rawWords
        .slice(i, i + 2)
        .join(" ")
        .toUpperCase()
    );
  }

  let response: Response;

  try {
    response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: cleanText,
        lang,
      }),
    });
  } catch {
    throw new Error(
      "No se pudo conectar con el generador de voz. Comprueba tu conexión o desactiva temporalmente el bloqueador de contenido."
    );
  }

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => null);

    throw new Error(
      errorData?.error ||
        "No se pudo generar la voz. Vuelve a intentarlo."
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    contentType.includes("application/json") ||
    contentType.includes("text/html")
  ) {
    throw new Error(
      "El servidor no devolvió un archivo de audio válido."
    );
  }

  const audioBlob = await response.blob();

  if (audioBlob.size < 500) {
    throw new Error(
      "El audio generado está vacío o no es válido."
    );
  }

  return {
    audioBlob,
    wordChunks,
  };
}

export async function generateViralMusic(
  duration: number
): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error(
      "La música sólo puede generarse en el navegador."
    );
  }

  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  const OfflineAudioContextClass =
    window.OfflineAudioContext ||
    (
      window as typeof window & {
        webkitOfflineAudioContext?: typeof OfflineAudioContext;
      }
    ).webkitOfflineAudioContext;

  if (!OfflineAudioContextClass) {
    throw new Error(
      "Tu navegador no soporta generación de audio."
    );
  }

  void AudioContextClass;

  const safeDuration = Math.max(
    1,
    Math.min(60, Number(duration) || 10)
  );

  const sampleRate = 44100;
  const totalSeconds = safeDuration + 0.25;

  const offlineCtx = new OfflineAudioContextClass(
    2,
    Math.ceil(sampleRate * totalSeconds),
    sampleRate
  );

  const master = offlineCtx.createGain();
  master.gain.value = 0.18;
  master.connect(offlineCtx.destination);

  const bpm = 112;
  const beat = 60 / bpm;
  const bar = beat * 4;

  const bassNotes = [110, 98, 130.81, 123.47];
  const chordNotes = [
    [220, 261.63, 329.63],
    [196, 246.94, 293.66],
    [261.63, 329.63, 392],
    [246.94, 293.66, 369.99],
  ];

  for (let t = 0, step = 0; t < safeDuration + beat; t += beat, step++) {
    const kick = offlineCtx.createOscillator();
    const kickGain = offlineCtx.createGain();

    kick.type = "sine";
    kick.frequency.setValueAtTime(130, t);
    kick.frequency.exponentialRampToValueAtTime(
      48,
      t + 0.12
    );

    kickGain.gain.setValueAtTime(0.7, t);
    kickGain.gain.exponentialRampToValueAtTime(
      0.001,
      t + 0.18
    );

    kick.connect(kickGain);
    kickGain.connect(master);

    kick.start(t);
    kick.stop(t + 0.2);

    const hat = offlineCtx.createOscillator();
    const hatGain = offlineCtx.createGain();

    hat.type = "square";
    hat.frequency.value = 7500;

    const hatTime = t + beat / 2;

    hatGain.gain.setValueAtTime(0.045, hatTime);
    hatGain.gain.exponentialRampToValueAtTime(
      0.001,
      hatTime + 0.045
    );

    hat.connect(hatGain);
    hatGain.connect(master);

    hat.start(hatTime);
    hat.stop(hatTime + 0.05);

    const bass = offlineCtx.createOscillator();
    const bassGain = offlineCtx.createGain();

    bass.type = "triangle";
    bass.frequency.value =
      bassNotes[step % bassNotes.length];

    bassGain.gain.setValueAtTime(0.12, t);
    bassGain.gain.setValueAtTime(
      0.001,
      Math.min(t + beat * 0.85, safeDuration)
    );

    bass.connect(bassGain);
    bassGain.connect(master);

    bass.start(t);
    bass.stop(
      Math.min(t + beat * 0.9, safeDuration + 0.1)
    );
  }

  for (
    let t = 0, barIndex = 0;
    t < safeDuration;
    t += bar, barIndex++
  ) {
    const notes =
      chordNotes[barIndex % chordNotes.length];

    for (const frequency of notes) {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();

      osc.type = "sine";
      osc.frequency.value = frequency;

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(
        0.025,
        t + 0.08
      );
      gain.gain.setValueAtTime(
        0.025,
        Math.min(t + bar * 0.7, safeDuration)
      );
      gain.gain.linearRampToValueAtTime(
        0.0001,
        Math.min(t + bar * 0.95, safeDuration)
      );

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      osc.stop(
        Math.min(t + bar, safeDuration + 0.1)
      );
    }
  }

  const buffer = await offlineCtx.startRendering();

  return audioBufferToWav(buffer);
}

function audioBufferToWav(
  buffer: AudioBuffer
): Blob {
  const numberOfChannels =
    buffer.numberOfChannels;

  const bytesPerSample = 2;
  const blockAlign =
    numberOfChannels * bytesPerSample;

  const dataSize =
    buffer.length * blockAlign;

  const arrayBuffer =
    new ArrayBuffer(44 + dataSize);

  const view =
    new DataView(arrayBuffer);

  let offset = 0;

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(
        offset++,
        value.charCodeAt(i)
      );
    }
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;

  writeString("WAVE");
  writeString("fmt ");

  view.setUint32(offset, 16, true);
  offset += 4;

  view.setUint16(offset, 1, true);
  offset += 2;

  view.setUint16(
    offset,
    numberOfChannels,
    true
  );
  offset += 2;

  view.setUint32(
    offset,
    buffer.sampleRate,
    true
  );
  offset += 4;

  view.setUint32(
    offset,
    buffer.sampleRate * blockAlign,
    true
  );
  offset += 4;

  view.setUint16(
    offset,
    blockAlign,
    true
  );
  offset += 2;

  view.setUint16(
    offset,
    16,
    true
  );
  offset += 2;

  writeString("data");

  view.setUint32(
    offset,
    dataSize,
    true
  );
  offset += 4;

  const channels: Float32Array[] = [];

  for (
    let channel = 0;
    channel < numberOfChannels;
    channel++
  ) {
    channels.push(
      buffer.getChannelData(channel)
    );
  }

  for (let i = 0; i < buffer.length; i++) {
    for (
      let channel = 0;
      channel < numberOfChannels;
      channel++
    ) {
      const sample =
        Math.max(
          -1,
          Math.min(
            1,
            channels[channel][i]
          )
        );

      const intSample =
        sample < 0
          ? sample * 32768
          : sample * 32767;

      view.setInt16(
        offset,
        intSample,
        true
      );

      offset += 2;
    }
  }

  return new Blob(
    [arrayBuffer],
    { type: "audio/wav" }
  );
}
