import type { VideoClip } from "@/types";

function extractTikTokUrls(input: string): string[] {
  if (!input) return [];
  // Separa por líneas, comas o espacios
  const raw = input
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const urls: string[] = [];
  for (const token of raw) {
    // Si el token contiene espacios, buscar url dentro
    const match = token.match(/https?:\/\/[^\s]+tiktok\.com[^\s]*/i) || token.match(/https?:\/\/vm\.tiktok\.com\/[^\s]+/i);
    if (match) urls.push(match[0]);
    else if (token.startsWith("http")) urls.push(token);
  }
  // También buscar todas las urls si el input es un bloque grande
  if (urls.length === 0) {
    const all = input.match(/https?:\/\/[^\s]+/gi);
    if (all) {
      for (const u of all) if (u.includes("tiktok.com") || u.includes("vm.tiktok")) urls.push(u);
    }
  }
  return [...new Set(urls)];
}

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/i.test(url) || /vm\.tiktok/i.test(url);
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function getTikTokPlayUrl(tiktokUrl: string, onStatus?: (m: string) => void): Promise<string> {
  const encoded = encodeURIComponent(tiktokUrl);
  // Pasarela principal tikwm - CORS abierto y devuelve play sin marca
  const gateways: { name: string; api: string; parse: (j: unknown) => string | null }[] = [
    {
      name: "tikwm",
      api: `https://www.tikwm.com/api/?url=${encoded}&hd=1`,
      parse: (j: unknown) => {
        const jo = j as { data?: { play?: string; hdplay?: string; wmplay?: string }; code?: number };
        if (jo?.data?.play) return jo.data.play;
        if (jo?.data?.hdplay) return jo.data.hdplay;
        return null;
      },
    },
    {
      name: "tikwm-cors",
      api: `https://corsproxy.io/?${encodeURIComponent(`https://www.tikwm.com/api/?url=${encoded}&hd=1`)}`,
      parse: (j: unknown) => {
        const jo = j as { data?: { play?: string; hdplay?: string } };
        if (jo?.data?.play) return jo.data.play;
        if (jo?.data?.hdplay) return jo.data.hdplay;
        // corsproxy devuelve texto, intentar parsear
        try {
          const parsed = typeof j === "string" ? JSON.parse(j as string) : j;
          const p = parsed as { data?: { play?: string } };
          return p?.data?.play || null;
        } catch { return null; }
      },
    },
  ];

  for (const gw of gateways) {
    try {
      if (onStatus) onStatus(`Probando ${gw.name}...`);
      const res = await fetchWithTimeout(gw.api, 8000);
      if (!res.ok) continue;
      const text = await res.text();
      let json: unknown;
      try { json = JSON.parse(text); } catch { continue; }
      const play = gw.parse(json);
      if (play && typeof play === "string" && play.startsWith("http")) return play;
    } catch {
      continue;
    }
  }
  throw new Error("No se pudo obtener el vídeo sin marca. Verifica que el enlace sea público.");
}

async function downloadVideoAsBlob(playUrl: string): Promise<Blob> {
  // Intento directo
  try {
    const res = await fetchWithTimeout(playUrl, 12000);
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("video") || ct.includes("octet-stream") || res.headers.get("content-length")) {
        const blob = await res.blob();
        if (blob.size > 10000) return blob;
      } else {
        // Algunos CDN devuelven video con content-type video/mp4 aunque ok
        const blob = await res.blob();
        if (blob.size > 10000 && blob.type.includes("video")) return blob;
        if (blob.size > 50000) return blob;
      }
    }
  } catch {}
  // Fallback via corsproxy
  try {
    const prox = `https://corsproxy.io/?${encodeURIComponent(playUrl)}`;
    const res = await fetchWithTimeout(prox, 12000);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 10000) return blob;
    }
  } catch {}
  throw new Error("No se pudo descargar el vídeo");
}

export async function fetchTikTokClips(
  input: string,
  onStatus?: (msg: string) => void
): Promise<{ clips: VideoClip[]; errors: string[] }> {
  const urls = extractTikTokUrls(input);
  if (urls.length === 0) throw new Error("Pega al menos un enlace de TikTok válido");
  if (urls.length > 5) throw new Error("Máximo 5 enlaces a la vez");
  for (const u of urls) if (!isTikTokUrl(u)) throw new Error(`Enlace no válido: ${u}`);

  const clips: VideoClip[] = [];
  const errors: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      if (onStatus) onStatus(`Descargando ${i + 1}/${urls.length} sin marca...`);
      const playUrl = await getTikTokPlayUrl(url, onStatus);
      if (onStatus) onStatus(`Bajando vídeo ${i + 1}/${urls.length}...`);
      const blob = await downloadVideoAsBlob(playUrl);
      const fileName = `tiktok-${Date.now()}-${i}.mp4`;
      const file = new File([blob], fileName, { type: blob.type || "video/mp4" });
      const blobUrl = URL.createObjectURL(blob);
      // Duración se calculará luego en page, poner 3 temporal
      clips.push({ file, url: blobUrl, startOffset: 0, playDuration: 3 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${url}: ${msg}`);
    }
  }

  if (clips.length === 0) {
    throw new Error(errors.join("\n") || "No se pudo descargar ningún vídeo");
  }

  // Calcular duración real de cada blob
  for (const clip of clips) {
    const dur = await new Promise<number>((res) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.src = clip.url;
      let done = false;
      const finish = (d: number) => {
        if (done) return;
        done = true;
        v.removeAttribute("src");
        try { v.load(); } catch {}
        v.remove();
        res(d);
      };
      v.onloadedmetadata = () => finish(Number.isFinite(v.duration) && v.duration > 0.5 ? v.duration : 4);
      v.onerror = () => finish(4);
      setTimeout(() => finish(4), 2500);
    });
    clip.playDuration = dur;
  }

  return { clips, errors };
}
