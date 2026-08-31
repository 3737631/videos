import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("v") || "";
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  try {
    const ytdl = await import("ytdl-core");
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${id}`);
    const format = ytdl.chooseFormat(info.formats, { quality: "18", filter: "videoandaudio" }) || ytdl.chooseFormat(info.formats, { filter: "videoandaudio" });
    if (!format?.url) return NextResponse.json({ error: "No url" }, { status: 404 });
    return NextResponse.json({ url: format.url, title: info.videoDetails.title }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
