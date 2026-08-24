/**
 * Detección heurística de marcas de agua (logos estáticos tipo TikTok).
 * Muestrea frames del vídeo y busca esquinas con contenido estático
 * de alto contraste que no cambia en el tiempo.
 */
export async function detectWatermark(url: string): Promise<boolean> {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 12000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error("load"));
      };
    });

    const W = 96;
    const H = Math.max(36, Math.round((W * video.videoHeight) / Math.max(1, video.videoWidth)));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;

    const positions = [0.08, 0.28, 0.5, 0.72, 0.92];
    const frames: Float32Array[] = [];
    for (const p of positions) {
      const t = Math.min(Math.max(0.05, p) * (video.duration || 1), Math.max(0, (video.duration || 0) - 0.05));
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, W, H);
      const { data } = ctx.getImageData(0, 0, W, H);
      const gray = new Float32Array(W * H);
      for (let i = 0; i < gray.length; i++) {
        gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }
      frames.push(gray);
    }
    if (frames.length < 3) return false;

    // Mapa de varianza temporal por píxel
    const n = frames.length;
    const mean = new Float32Array(W * H);
    for (const f of frames) for (let i = 0; i < mean.length; i++) mean[i] += f[i] / n;
    const std = new Float32Array(W * H);
    for (const f of frames) for (let i = 0; i < std.length; i++) {
      const d = f[i] - mean[i];
      std[i] += (d * d) / n;
    }
    for (let i = 0; i < std.length; i++) std[i] = Math.sqrt(std[i]);

    // Ventanas de esquina (ancho 26%, alto 24%) + centro-inferior
    const wins: Array<[number, number]> = [
      [0, 0],
      [W - Math.round(W * 0.26), 0],
      [0, H - Math.round(H * 0.24)],
      [W - Math.round(W * 0.26), H - Math.round(H * 0.24)],
    ];
    const ww = Math.round(W * 0.26);
    const wh = Math.round(H * 0.24);

    for (const [x0, y0] of wins) {
      let suspicious = 0;
      let total = 0;
      for (let y = y0; y < y0 + wh && y < H; y++) {
        for (let x = x0; x < x0 + ww && x < W; x++) {
          const i = y * W + x;
          total++;
          // Estático en el tiempo pero con contraste alto respecto al fondo medio
          if (std[i] < 5 && Math.abs(mean[i] - median(frames[0])) > 20) suspicious++;
        }
      }
      if (total > 0 && suspicious / total > 0.03) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {}
  }
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    // Timeout OBLIGATORIO: en iOS el evento "seeked" a veces no dispara y
    // sin esto detectWatermark se congelaria para siempre.
    const kill = setTimeout(resolve, 4000);
    const done = () => {
      clearTimeout(kill);
      video.removeEventListener("seeked", done);
      setTimeout(resolve, 60);
    };
    video.addEventListener("seeked", done);
    try {
      video.currentTime = t;
    } catch {
      clearTimeout(kill);
      resolve();
    }
  });
}

function median(arr: Float32Array): number {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 0;
}
