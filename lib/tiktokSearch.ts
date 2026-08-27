export interface TikTokSearchResult {
  id: string;
  play: string;
  cover: string;
  author: string;
  duration: number;
  likes: number;
  desc: string;
}

async function fetchWithTimeout(url: string, ms = 9000, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal, cache: "no-store" } as RequestInit);
  } finally { clearTimeout(id); }
}

function correctKeyword(kw: string): string {
  return kw.toLowerCase().replace(/\s+/g, " ").replace(/d\s+emanchas/g, "de manchas").replace(/limpiador\s+d\s+/g, "limpiador de ").trim();
}

export async function searchTikTokClean(keyword: string, count = 8, onStatus?: (m: string) => void): Promise<TikTokSearchResult[]> {
  const rawClean = keyword.trim().replace(/https?:\/\/\S+/g, "").slice(0, 40);
  const clean = correctKeyword(rawClean);
  if (!clean || clean.length < 2) throw new Error("Escribe el nombre del producto");
  const encoded = encodeURIComponent(clean);

  const gateways: { url: string; init?: RequestInit }[] = [
    { url: `https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1` },
    { url: `https://www.tikwm.com/api/feed/search`, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords: clean, count, cursor: 0, HD: 1 }) } },
    { url: `https://corsproxy.io/?${encodeURIComponent(`https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`)}` },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`)}` },
    { url: `https://thingproxy.freeboard.io/fetch/https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1` },
  ];

  let lastErr = "";
  for (const gw of gateways) {
    try {
      if (onStatus) onStatus(`Buscando "${clean}"...`);
      const res = await fetchWithTimeout(gw.url, 10000, gw.init);
      if (!res.ok) {
        // Algunos proxies devuelven 403 pero con cuerpo válido
        const t = await res.text().catch(() => "");
        if (!t || !t.includes("play")) { lastErr = `status ${res.status}`; continue; }
        // Si hay play dentro, intentar parsear aunque status !=200
        try {
          const j = JSON.parse(t);
          const d = (j as { data?: { videos?: unknown[] } })?.data?.videos;
          if (Array.isArray(d) && d.length > 0) {
            // tratar como éxito
          } else { lastErr = `status ${res.status}`; continue; }
        } catch { lastErr = `status ${res.status}`; continue; }
      }
      const text = await res.text();
      let json: unknown;
      try { json = JSON.parse(text); } catch {
        // allorigins/raw puede devolver ya el JSON interior
        try { json = JSON.parse((JSON.parse(text) as { contents: string }).contents); } catch { continue; }
      }
      // allorigins/get devuelve {contents: "..."}
      if (json && typeof (json as { contents?: unknown }).contents === "string") {
        try { json = JSON.parse((json as { contents: string }).contents); } catch {}
      }
      const data = (json as { data?: { videos?: unknown[] }; videos?: unknown[] })?.data?.videos || (json as { videos?: unknown[] })?.videos || (json as { data?: unknown[] })?.data;
      const arr = Array.isArray(data) ? data : Array.isArray(json) ? json as unknown[] : [];
      if (!Array.isArray(arr) || arr.length === 0) { lastErr = "sin resultados"; continue; }
      const mapped: TikTokSearchResult[] = [];
      for (const v of arr) {
        const o = v as Record<string, unknown>;
        const play = (o.play as string) || (o.hdplay as string) || (o.downloadAddr as string) || (o.video as Record<string, unknown> | undefined)?.downloadAddr as string;
        if (!play || typeof play !== "string" || !play.startsWith("http")) continue;
        const id = String(o.video_id || o.id || o.aweme_id || (o.video as Record<string, unknown> | undefined)?.id || Math.random().toString(36).slice(2));
        const cover = String(o.cover || o.origin_cover || o.ai_dynamic_cover || (o.video as Record<string, unknown> | undefined)?.cover || "");
        const authorObj = o.author as Record<string, unknown> | string | undefined;
        const author = String(typeof authorObj === "object" && authorObj ? (authorObj.unique_id as string) || "" : (authorObj as string) || "@tiktok");
        const duration = Number(o.duration || (o.video as Record<string, unknown> | undefined)?.duration || 0) || 7;
        const likes = Number(o.digg_count || (o.stats as Record<string, unknown> | undefined)?.digg_count || 0);
        const desc = String(o.title || o.desc || (o.video as Record<string, unknown> | undefined)?.desc || "");
        if (duration < 4 || duration > 18) continue;
        if (desc.length > 140) continue;
        mapped.push({ id, play, cover: cover || `https://picsum.photos/seed/${id}/270/480`, author, duration, likes, desc });
      }
      if (mapped.length === 0) { lastErr = "ningún vídeo limpio"; continue; }
      mapped.sort((a, b) => b.likes - a.likes);
      return mapped.slice(0, 6);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
  }
  throw new Error(`No se encontraron vídeos para "${clean}" (${lastErr}). Prueba a subir tu propio vídeo o pega enlaces manualmente.`);
}
