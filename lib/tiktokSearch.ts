export interface TikTokSearchResult {
  id: string;
  play: string;
  cover: string;
  author: string;
  duration: number;
  likes: number;
  desc: string;
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { signal: c.signal, cache: "no-store" });
  } finally { clearTimeout(id); }
}

export async function searchTikTokClean(keyword: string, count = 8, onStatus?: (m: string) => void): Promise<TikTokSearchResult[]> {
  const clean = keyword.trim().replace(/https?:\/\/\S+/g, "").slice(0, 40);
  if (!clean || clean.length < 2) throw new Error("Escribe el nombre del producto");
  const encoded = encodeURIComponent(clean);
  const gateways = [
    `https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`,
    `https://corsproxy.io/?${encodeURIComponent(`https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`)}`,
  ];
  let lastErr = "";
  for (const api of gateways) {
    try {
      if (onStatus) onStatus(`Buscando "${clean}"...`);
      const res = await fetchWithTimeout(api, 9000);
      if (!res.ok) { lastErr = `status ${res.status}`; continue; }
      const text = await res.text();
      let json: unknown;
      try { json = JSON.parse(text); } catch { continue; }
      const data = (json as { data?: { videos?: unknown[] }; videos?: unknown[] })?.data?.videos || (json as { videos?: unknown[] })?.videos;
      if (!Array.isArray(data) || data.length === 0) { lastErr = "sin resultados"; continue; }
      const mapped: TikTokSearchResult[] = [];
      for (const v of data) {
        const o = v as Record<string, unknown>;
        const play = (o.play as string) || (o.hdplay as string) || (o.downloadAddr as string);
        if (!play) continue;
        const id = String(o.video_id || o.id || o.aweme_id || Math.random().toString(36).slice(2));
        const cover = String(o.cover || o.origin_cover || o.ai_dynamic_cover || "");
        const author = String((o.author as Record<string, unknown>)?.unique_id || (o.author as string) || "@tiktok");
        const duration = Number(o.duration || (o.video as Record<string, unknown> | undefined)?.duration || 0) || 7;
        const likes = Number(o.digg_count || (o.stats as Record<string, unknown> | undefined)?.digg_count || 0);
        const desc = String(o.title || o.desc || "");
        // Filtro limpio: 4-18s, sin texto excesivo en descripción
        if (duration < 4 || duration > 18) continue;
        // Evitar vídeos con mucho texto en desc (suelen ser con marca)
        if (desc.length > 120) continue;
        mapped.push({ id, play, cover, author, duration, likes, desc });
      }
      if (mapped.length === 0) { lastErr = "ningún vídeo limpio"; continue; }
      // Ordenar por likes y coger los mejores
      mapped.sort((a, b) => b.likes - a.likes);
      return mapped.slice(0, 6);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
  }
  throw new Error(`No se encontraron vídeos limpios para "${clean}": ${lastErr}`);
}
