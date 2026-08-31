import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("v") || "";
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "en-US,en;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const html = await r.text();
    const start = html.indexOf("ytInitialPlayerResponse");
    if (start === -1) return NextResponse.json({ error: "no player" }, { status: 404 });
    const braceStart = html.indexOf("{", start);
    let depth = 0; let end = -1;
    for (let i = braceStart; i < html.length; i++) {
      const c = html[i];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return NextResponse.json({ error: "no json" }, { status: 404 });
    const jsonStr = html.slice(braceStart, end + 1);
    const j = JSON.parse(jsonStr) as { streamingData?: { adaptiveFormats?: { url?: string; mimeType?: string }[]; formats?: { url?: string; mimeType?: string }[] }; videoDetails?: { title?: string } };
    const streamingData = j.streamingData as { adaptiveFormats?: { url?: string; mimeType?: string; qualityLabel?: string }[]; formats?: { url?: string; mimeType?: string }[] } | undefined;
    const formats = [...(streamingData?.formats || []), ...(streamingData?.adaptiveFormats || [])];
    // Prefer mp4 with audio
    let best = formats.find(f => f.mimeType?.includes("mp4") && f.url && f.mimeType?.includes("audio")) || formats.find(f => f.mimeType?.includes("mp4") && f.url) || formats.find(f => f.url);
    if (!best?.url) return NextResponse.json({ error: "no url" }, { status: 404 });
    // Unescape url
    const url = best.url.replace(/\\u0026/g, "&");
    return NextResponse.json({ url, title: j.videoDetails?.title || id }, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
