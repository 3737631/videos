/**
 * Mezclador de audio FINAL: voz (100%) + música (10-18%) → WAV estéreo.
 * La música se repite en bucle si dura menos que el vídeo y se recorta si dura más.
 */

export function encodeWavStereo(chans: Float32Array[], sampleRate: number): Blob {
  const frames = chans[0].length;
  const nCh = chans.length;
  const data = new Int16Array(frames * nCh);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = chans[c][i];
      if (!isFinite(s)) s = 0;
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      data[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  const blockAlign = nCh * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(data.buffer));
  return new Blob([buffer], { type: "audio/wav" });
}

export interface MixOptions {
  durationSec: number;
  /** 0..1 relativo a la voz; por defecto 0.14 (la voz SIEMPRE domina) */
  musicVolume?: number;
  voiceVolume?: number;
}

interface MinimalCtxCtor {
  new (channels: number, length: number, sampleRate: number): OfflineAudioContext;
}

function getOfflineCtor(): MinimalCtxCtor {
  const w = window as unknown as {
    OfflineAudioContext?: MinimalCtxCtor;
    webkitOfflineAudioContext?: MinimalCtxCtor;
  };
  return (w.OfflineAudioContext || w.webkitOfflineAudioContext)!;
}

export async function mixVoiceAndMusic(
  voiceBlob: Blob | null,
  musicBlob: Blob | null,
  opts: MixOptions
): Promise<Blob | null> {
  if (!voiceBlob && !musicBlob) return null;
  const OC = getOfflineCtor();
  const sr = 44100;
  const dur = Math.max(0.5, opts.durationSec + 0.3);
  const ctx = new OC(2, Math.ceil(dur * sr), sr);

  if (voiceBlob) {
    const buf = await ctx.decodeAudioData(await voiceBlob.arrayBuffer());
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = opts.voiceVolume ?? 1;
    s.connect(g);
    g.connect(ctx.destination);
    s.start(0);
  }
  if (musicBlob) {
    const buf = await ctx.decodeAudioData(await musicBlob.arrayBuffer());
    // BUCLE si la pista es más corta que el vídeo; TRIM automático con -shortest/duración fija
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = buf.duration < dur - 0.05;
    const g = ctx.createGain();
    g.gain.value = Math.max(0.08, Math.min(0.18, opts.musicVolume ?? 0.14));
    s.connect(g);
    g.connect(ctx.destination);
    s.start(0);
  }

  const rendered = await ctx.startRendering();
  const L = rendered.getChannelData(0);
  const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
  return encodeWavStereo([L, R], sr);
}
