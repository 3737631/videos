import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ANDROID_CLIENTS = [
  { clientName: "ANDROID", clientVersion: "21.02.13", androidSdkVersion: 30 },
  { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30 },
  { clientName: "ANDROID", clientVersion: "18.31.32", androidSdkVersion: 28 },
];

async function getWatchCookies(): Promise<{ cookie: string; visitorId: string }> {
  try {
    const r = await fetch(`https://www.youtube.com/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const setCookies = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    const cookie = setCookies.map((c: string) => c.split(";")[0]).join("; ");
    const visitorId = r.headers.get("x-goog-visitor-id") || "";
    return { cookie, visitorId };
  } catch { return { cookie: "", visitorId: "" }; }
}

async function postPlayer(id: string, client: { clientName: string; clientVersion: string; androidSdkVersion?: number }, env: { cookie: string; visitorId: string }) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.youtube.com/",
      "Origin": "https://www.youtube.com",
      ...(env.cookie ? { "Cookie": env.cookie } : {}),
      ...(env.visitorId ? { "X-Goog-Visitor-Id": env.visitorId } : {}),
    },
    body: JSON.stringify({ context: { client }, videoId: id }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`player http ${r.status}`);
  return JSON.parse(t);
}

async function getPlayUrl(id: string): Promise<string> {
  const env = await getWatchCookies();
  let lastErr = "";
  for (const client of ANDROID_CLIENTS) {
    try {
      const j = await postPlayer(id, client, env) as {
        playabilityStatus?: { status?: string; reason?: string };
        streamingData?: { formats?: { url?: string; mimeType?: string }[]; adaptiveFormats?: { url?: string; mimeType?: string; qualityLabel?: string }[] };
      };
      if (j.playabilityStatus && j.playabilityStatus.status !== "OK") { lastErr = `playability ${j.playabilityStatus.status}: ${j.playabilityStatus.reason || ""}`; continue; }
      const formats = [...(j.streamingData?.formats || []), ...(j.streamingData?.adaptiveFormats || [])];
      const withUrl = formats.filter(f => f.url);
      if (withUrl.length === 0) { lastErr = "no url in formats"; continue; }
      const best = withUrl.find(f => f.mimeType?.includes("mp4") && f.mimeType?.includes("audio")) || withUrl.find(f => f.mimeType?.includes("mp4")) || withUrl[0];
      return best.url!.replace(/\\u0026/g, "&");
    } catch (e) { lastErr = `req ${client.clientVersion}: ${(e as Error).message}`; }
  }
  throw new Error(`no stream url (${lastErr})`);
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("v") || "";
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const jsonMode = req.nextUrl.searchParams.get("json") === "1";
  try {
    const url = await getPlayUrl(id);
    if (jsonMode) return NextResponse.json({ url, id }, { headers: { "Access-Control-Allow-Origin": "*" } });
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.youtube.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok || !res.body) return NextResponse.json({ error: "video fetch failed " + res.status }, { status: 502 });
    const ct = res.headers.get("content-type") || "video/mp4";
    return new NextResponse(res.body as ReadableStream, {
      headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Disposition": `inline; filename="yt-${id}.mp4"` },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}