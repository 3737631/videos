import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    // YouTubei ANDROID client - no signature needed, returns direct URL
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } },
        videoId: id,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json() as { streamingData?: { adaptiveFormats?: { url: string; mimeType: string }[]; formats?: { url: string; mimeType: string }[] } };
    const formats = [...(j.streamingData?.formats || []), ...(j.streamingData?.adaptiveFormats || [])];
    // Prefer mp4 with audio
    const mp4 = formats.find(f => f.mimeType?.includes("mp4") && f.url) || formats.find(f=>f.url);
    if (mp4?.url) return NextResponse.json({ url: mp4.url }, { headers: { "Access-Control-Allow-Origin": "*" } });
    return NextResponse.json({ error: "no url" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
