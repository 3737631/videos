import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const count = Math.min(Number(req.nextUrl.searchParams.get("count") || "6"), 8);
  if (!q || q.length < 2) return NextResponse.json({ error: "Falta q" }, { status: 400 });
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q + " shorts")}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "es-ES,es;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const html = await r.text();
    const ids = new Set<string>();
    const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    const list = [...ids].slice(0, count);
    const videos = list.map(id => ({
      video_id: id,
      id,
      play: `https://www.youtube.com/watch?v=${id}`,
      cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      author: { unique_id: "youtube" },
      duration: 7,
      digg_count: 5000,
      title: q,
      webUrl: `https://www.youtube.com/watch?v=${id}`,
    }));
    return NextResponse.json({ data: { videos } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
