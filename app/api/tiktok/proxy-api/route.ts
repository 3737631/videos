import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  if (!url || !url.includes("tiktok.com")) return NextResponse.json({ error: "bad url" }, { status: 400 });
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://www.tiktok.com/",
        Accept: "application/json, text/plain, */*",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: {
        "Content-Type": r.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
