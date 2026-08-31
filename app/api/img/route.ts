import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  if (!url) return NextResponse.json({ error: "no url" }, { status: 400 });
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, { status: 200, headers: { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
