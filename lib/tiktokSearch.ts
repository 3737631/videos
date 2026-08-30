export interface TikTokSearchResult {
  id: string;
  play: string;
  cover: string;
  author: string;
  duration: number;
  likes: number;
  desc: string;
}

async function fetchWithTimeout(url: string, ms = 6000, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal, cache: "no-store" } as RequestInit);
  } finally { clearTimeout(id); }
}

function correctKeyword(kw: string): string {
  return kw.toLowerCase().replace(/\s+/g, " ").replace(/d\s+emanchas/g, "de manchas").replace(/limpiador\s+d\s+/g, "limpiador de ").trim();
}

function getKeywordVariants(clean: string): string[] {
  const v: string[] = [clean];
  if (clean.includes("tijera") && !clean.includes("tijeras")) v.push(clean.replace("tijera", "tijeras"));
  if (clean.includes("tijeras laser") || clean.includes("tijera con laser")) v.push("tijeras laser", "tijeras", "scissors");
  else if (clean.includes("con")) {
    const w = clean.replace(/\s+con\s+/g, " ").trim();
    if (w !== clean) v.push(w);
  }
  const words = clean.split(/\s+/).filter(w => w.length > 2 && !["con","para","de","del","la","el"].includes(w));
  for (const w of words) if (!v.includes(w)) v.push(w);
  if (clean.includes("tijera")) v.push("scissors");
  if (clean.includes("limpiador")) v.push("cleaner");
  return [...new Set(v)].slice(0, 3);
}

async function tryFetchVariant(variant: string, count: number): Promise<TikTokSearchResult[]> {
  const encoded = encodeURIComponent(variant);
  const urls = [
    `https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`,
    `https://corsproxy.io/?${encodeURIComponent(`https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`)}`,
  ];
  // Lanzar las 3 en paralelo, gana la primera que devuelva vídeos
  const promises = urls.map(async (url) => {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      try { json = JSON.parse((JSON.parse(text) as { contents: string }).contents); } catch { throw new Error("json"); }
    }
    if (json && typeof (json as { contents?: unknown }).contents === "string") {
      try { json = JSON.parse((json as { contents: string }).contents); } catch {}
    }
    const data = (json as { data?: { videos?: unknown[] }; videos?: unknown[] })?.data?.videos || (json as { videos?: unknown[] })?.videos || (json as { data?: unknown[] })?.data;
    const arr = Array.isArray(data) ? data : Array.isArray(json) ? json as unknown[] : [];
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("sin resultados");
    const mapped: TikTokSearchResult[] = [];
    for (const v of arr) {
      const o = v as Record<string, unknown>;
      const play = (o.play as string) || (o.hdplay as string) || (o.downloadAddr as string) || (o.video as Record<string, unknown> | undefined)?.downloadAddr as string;
      if (!play || !play.startsWith("http")) continue;
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
    if (mapped.length === 0) throw new Error("ningún vídeo limpio");
    mapped.sort((a, b) => b.likes - a.likes);
    return mapped.slice(0, 6);
  });
  // Usar any para que el primero que tenga éxito gane, si todos fallan lanza el último error
  return Promise.any(promises);
}

export async function searchTikTokClean(keyword: string, count = 8, onStatus?: (m: string) => void): Promise<TikTokSearchResult[]> {
  const rawClean = keyword.trim().replace(/https?:\/\/\S+/g, "").slice(0, 40);
  const clean = correctKeyword(rawClean);
  if (!clean || clean.length < 2) throw new Error("Escribe el nombre del producto");
  const variants = getKeywordVariants(clean);
  // Probar variantes en orden, pero cada variante en paralelo entre gateways (rápido, sin permisos)
  for (const variant of variants) {
    if (onStatus) onStatus(`Buscando "${variant}" en todo TikTok...`);
    try {
      const res = await tryFetchVariant(variant, count);
      if (res.length > 0) return res;
    } catch {}
  }
  throw new Error(`No se encontraron vídeos para "${clean}". Prueba con "${variants[1] || "tijeras"}" o sube tu propio vídeo.`);
}
