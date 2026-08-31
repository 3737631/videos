import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Bot automático: busca en TikTok web y resuelve play sin marca solo
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || req.nextUrl.searchParams.get("keyword") || "";
  const count = Math.min(Number(req.nextUrl.searchParams.get("count") || "6"), 8);
  if (!q || q.length < 2) return NextResponse.json({ error: "Falta q" }, { status: 400 });

  const headers: HeadersInit = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    Referer: "https://www.tiktok.com/",
  };

  try {
    // 1) Coger IDs reales de búsqueda TikTok
    const target = `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`;
    const htmlRes = await fetch(target, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const html = await htmlRes.text();

    // Extraer IDs de vídeo de la página (varias formas)
    const ids = new Set<string>();
    // Forma 1: /video/19 dígitos
    const re = /\/video\/(\d{19})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    // Forma 2: REHYDRATION JSON
    const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]+?)<\/script>/);
    if (rehydrationMatch) {
      try {
        const j = JSON.parse(rehydrationMatch[1]);
        const stack: unknown[] = [j];
        while (stack.length) {
          const o = stack.pop() as Record<string, unknown>;
          if (!o || typeof o !== "object") continue;
          for (const [k, v] of Object.entries(o)) {
            if (k === "id" && typeof v === "string" && /^\d{19}$/.test(v)) ids.add(v);
            if (k === "awemeId" && typeof v === "string" && /^\d{19}$/.test(v)) ids.add(v);
            if (v && typeof v === "object") stack.push(v as unknown);
          }
        }
      } catch {}
    }
    const idList = [...ids].slice(0, count);
    if (idList.length === 0) return NextResponse.json({ data: { videos: [] } });

    // 2) Resolver cada ID a play sin marca vía nuestro download (server IP limpia)
    const origin = req.nextUrl.origin;
    const videos: unknown[] = [];
    for (const id of idList) {
      const tiktokUrl = `https://www.tiktok.com/@i/video/${id}`;
      try {
        const r = await fetch(`${origin}/api/tiktok/download?url=${encodeURIComponent(tiktokUrl)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json() as { play?: string };
        if (j.play) {
          videos.push({
            video_id: id,
            id,
            play: j.play,
            cover: `https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/${id}~tplv-tiktokx-360p.jpeg`,
            author: { unique_id: "tiktok" },
            duration: 7,
            digg_count: 5000,
            title: q,
          });
        }
      } catch {}
      if (videos.length >= count) break;
    }
    // Si no se resolvió ninguno, devolver IDs para que el cliente intente directo
    if (videos.length === 0) {
      return NextResponse.json({ data: { videos: idList.map(id => ({ video_id: id, id, play: `https://www.tiktok.com/@i/video/${id}`, cover: `https://picsum.photos/seed/${id}/270/480`, author: { unique_id: "tiktok" }, duration: 7, digg_count: 1000, title: q })) } });
    }
    return NextResponse.json({ data: { videos } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
