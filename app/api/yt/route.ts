import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "edge";

// Método de servicios de clipping YT (yt-dlp ANDROID_VR / pixeltui / gt-innertube):
// el cliente ANDROID_VR (Oculus Quest) devuelve URLs firmadas directas sin
// descifrado de firma, con TODA la calidad. Requiere visitorData + contentCheckOk.
const CLIENTS = [
  { name: "ANDROID_VR", version: "1.65.10", make: "Oculus", model: "Quest 3", sdk: 32, os: "12L" },
  { name: "ANDROID", version: "20.11.37", sdk: 30 },
  { name: "ANDROID", version: "21.02.13", sdk: 30 },
  { name: "ANDROID", version: "19.09.37", sdk: 30 },
  { name: "IOS", version: "19.29.1" },
];
const VR_UA = "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
const ANDROID_UA = "com.google.android.youtube/21.02.13 (Linux; U; Android 13; en_US) gzip";
const IOS_UA = "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X;)";
const UA = { ANDROID_VR: VR_UA, ANDROID: ANDROID_UA, IOS: IOS_UA } as Record<string, string>;
const PLAYER = "youtubei.googleapis.com/youtubei/v1/player";
const VISITOR = "youtubei.googleapis.com/youtubei/v1/visitor_id";

async function visitorData(): Promise<string> {
  try {
    const body = { context: { client: { clientName: "ANDROID_VR", clientVersion: "1.65.10" } } };
    const r = await fetch(`https://${VISITOR}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": VR_UA },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json() as { responseContext?: { visitorData?: string } };
    return j.responseContext?.visitorData || "";
  } catch { return ""; }
}

async function postPlayer(id: string, vd: string, c: (typeof CLIENTS)[number]) {
  const client: Record<string, unknown> = { clientName: c.name, clientVersion: c.version };
  if (c.sdk) client.androidSdkVersion = c.sdk;
  if (c.make) client.deviceMake = c.make;
  if (c.model) client.deviceModel = c.model;
  if (c.os) client.osVersion = c.os;
  if (vd) client.visitorData = vd;
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": UA[c.name] || ANDROID_UA, "Accept-Language": "en-US,en;q=0.9" };
  if (vd) headers["X-Goog-Visitor-Id"] = vd;
  const r = await fetch(`https://${PLAYER}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ context: { client }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`player http ${r.status}: ${t.slice(0, 140)}`);
  return JSON.parse(t);
}

type Format = { url?: string; mimeType?: string; qualityLabel?: string; bitrate?: number; itag?: number };
function pickBest(withUrl: Format[]): { priority: string; url: string } | null {
  const score = (f: Format) => {
    const m = f.mimeType || "";
    let s = 0;
    if (m.includes("video/mp4")) s += 1000;
    const l = f.qualityLabel || "";
    const mH = parseInt(l.replace(/p.*/, ""), 10) || 0;
    s += mH;
    if (l.endsWith("60")) s += 200;
    return s;
  };
  const video = withUrl.filter(f => (f.mimeType || "").includes("video/") && !(f.mimeType || "").includes("audio")).sort((a, b) => score(b) - score(a))[0];
  if (video) return { priority: `video ${video.qualityLabel || video.mimeType}`, url: video.url!.replace(/\\u0026/g, "&") };
  const muxed = withUrl.filter(f => (f.mimeType || "").includes("video/") && (f.mimeType || "").includes("audio")).sort((a, b) => score(b) - score(a))[0];
  if (muxed) return { priority: `muxed ${muxed.qualityLabel || muxed.mimeType}`, url: muxed.url!.replace(/\\u0026/g, "&") };
  return null;
}

async function getPlay(id: string) {
  const attempts: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const c of CLIENTS) {
      try {
        const vd = await visitorData();
        const j = await postPlayer(id, vd, c) as {
          playabilityStatus?: { status?: string; reason?: string };
          streamingData?: { formats?: Format[]; adaptiveFormats?: Format[] };
        };
        const ps = j.playabilityStatus?.status || "?";
        if (ps !== "OK") { attempts.push(`${c.name}@${c.version}:play${ps}`); continue; }
        const formats = [...(j.streamingData?.formats || []), ...(j.streamingData?.adaptiveFormats || [])];
        const withUrl = formats.filter(f => f.url);
        if (withUrl.length === 0) { attempts.push(`${c.name}@${c.version}:nourl`); continue; }
        const best = pickBest(withUrl);
        if (!best) { attempts.push(`${c.name}@${c.version}:nobest`); continue; }
        return { url: best.url, quality: best.priority, client: `${c.name}@${c.version}`, attempts };
      } catch (e) { attempts.push(`${c.name}@${c.version}:${(e as Error).message}`); }
    }
  }
  throw new Error("no stream url [" + attempts.join(" | ") + "]");
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("v") || "";
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const jsonMode = req.nextUrl.searchParams.get("json") === "1";
  try {
    const { url, quality, client } = await getPlay(id);
    if (jsonMode) return NextResponse.json({ url, id, quality, client }, { headers: { "Access-Control-Allow-Origin": "*" } });
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
    const msg = String(e);
    if (msg.includes("no stream url")) return NextResponse.json({ error: msg }, { status: 500 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}