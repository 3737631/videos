import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Bot que coge enlaces de Compartir reales - extrae autor+id y resuelve sin marca
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

  // Helper: resolver tiktokUrl a play sin marca directo con tikwm (sin pasar por origin)
  async function resolvePlay(tiktokUrl: string): Promise<string | null> {
    const enc = encodeURIComponent(tiktokUrl);
    const gateways = [
      `https://www.tikwm.com/api/?url=${enc}&hd=1`,
      `https://tikwm.com/api/?url=${enc}&hd=1`,
    ];
    const h = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: "https://www.tikwm.com/",
      Origin: "https://www.tikwm.com",
    } as HeadersInit;
    for (const api of gateways) {
      try {
        const r = await fetch(api, { headers: h, cache: "no-store", signal: AbortSignal.timeout(8000) });
        const text = await r.text();
        if (text.includes("Just a moment") || text.includes("_cf_chl")) continue;
        const j = JSON.parse(text) as { code?: number; data?: { play?: string; hdplay?: string } };
        const play = j?.data?.play || j?.data?.hdplay;
        if (play && play.startsWith("http")) return play;
      } catch {}
    }
    return null;
  }

  try {
    // 1) Buscar en TikTok web - extraer enlaces reales de Compartir (author + id)
    const target = `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`;
    const htmlRes = await fetch(target, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const html = await htmlRes.text();

    // Extraer enlaces completos @autor/video/id - son los que copia el botón Compartir
    const links: { author: string; id: string; url: string }[] = [];
    const seen = new Set<string>();
    // Patrón principal: href="/@user/video/123"
    const reFull = /href="\/@([^\/"]+)\/video\/(\d{19})"/g;
    let m: RegExpExecArray | null;
    while ((m = reFull.exec(html)) !== null) {
      const author = m[1];
      const id = m[2];
      const url = `https://www.tiktok.com/@${author}/video/${id}`;
      if (!seen.has(id)) { seen.add(id); links.push({ author, id, url }); }
    }
    // Fallback: cualquier /video/ID
    if (links.length === 0) {
      const reId = /\/video\/(\d{19})/g;
      let m2: RegExpExecArray | null;
      while ((m2 = reId.exec(html)) !== null) {
        const id = m2[1];
        if (!seen.has(id)) { seen.add(id); links.push({ author: "tiktok", id, url: `https://www.tiktok.com/@tiktok/video/${id}` }); }
      }
    }
    // Rehydration JSON también
    const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]+?)<\/script>/);
    if (rehydrationMatch && links.length < count) {
      try {
        const j = JSON.parse(rehydrationMatch[1]);
        const stack: unknown[] = [j];
        while (stack.length && links.length < count + 4) {
          const o = stack.pop() as Record<string, unknown>;
          if (!o || typeof o !== "object") continue;
          // Buscar objetos con author + id juntos
          const authorObj = o.author as Record<string, unknown> | undefined;
          const vidId = (o.id as string) || (o.awemeId as string) || "";
          if (typeof vidId === "string" && /^\d{19}$/.test(vidId) && !seen.has(vidId)) {
            const author = (authorObj?.uniqueId as string) || (authorObj?.unique_id as string) || "tiktok";
            seen.add(vidId);
            links.push({ author, id: vidId, url: `https://www.tiktok.com/@${author}/video/${vidId}` });
          }
          for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v as unknown);
        }
      } catch {}
    }

    if (links.length === 0) {
      // No se encontró nada en TikTok web - probar tikwm feed/search directo como fallback
      try {
        const tikwmRes = await fetch(`https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(q)}&count=${count}&cursor=0&HD=1`, {
          headers: { "User-Agent": headers["User-Agent"] as string, Accept: "application/json", Referer: "https://www.tikwm.com/" },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        const text = await tikwmRes.text();
        if (!text.includes("Just a moment")) {
          const j = JSON.parse(text) as { data?: { videos?: unknown[] } };
          const vids = j?.data?.videos as Record<string, unknown>[] | undefined;
          if (vids && vids.length > 0) {
            const mapped = vids.slice(0, count).map((v) => {
              const play = (v.play as string) || (v.hdplay as string) || "";
              const id = String(v.video_id || v.id || "");
              const author = ((v.author as Record<string, unknown>)?.unique_id as string) || "tiktok";
              return { video_id: id, id, play, cover: (v.cover as string) || "", author: { unique_id: author }, duration: Number(v.duration || 7), digg_count: Number((v as Record<string, unknown>).digg_count || 0), title: (v.title as string) || q };
            }).filter(v => v.play);
            if (mapped.length > 0) return NextResponse.json({ data: { videos: mapped } });
          }
        }
      } catch {}
      return NextResponse.json({ data: { videos: [] } });
    }

    // 2) Resolver cada enlace de Compartir a play sin marca
    const videos: unknown[] = [];
    for (const link of links.slice(0, count + 2)) {
      const play = await resolvePlay(link.url);
      if (play) {
        videos.push({
          video_id: link.id,
          id: link.id,
          play,
          cover: `https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/${link.id}~tplv-tiktokx-360p.jpeg`,
          author: { unique_id: link.author },
          duration: 7,
          digg_count: 5000,
          title: q,
          webUrl: link.url,
        });
        if (videos.length >= count) break;
      }
    }

    // Si ninguno resolvió, devolver enlaces reales para que el cliente los pruebe
    if (videos.length === 0) {
      return NextResponse.json({
        data: {
          videos: links.slice(0, count).map(l => ({
            video_id: l.id, id: l.id, play: l.url, cover: `https://picsum.photos/seed/${l.id}/270/480`,
            author: { unique_id: l.author }, duration: 7, digg_count: 1000, title: q, webUrl: l.url,
          })),
        },
      });
    }
    return NextResponse.json({ data: { videos } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 200 });
  }
}
