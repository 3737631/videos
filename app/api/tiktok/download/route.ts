import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Server-side proxy para descargar sin marca - bypass CORS y con IP de Vercel
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  if (!url || !url.includes("tiktok.com")) return NextResponse.json({ error: "Falta url de TikTok" }, { status: 400 });
  const encoded = encodeURIComponent(url);
  const gateways = [
    `https://www.tikwm.com/api/?url=${encoded}&hd=1`,
    `https://tikwm.com/api/?url=${encoded}&hd=1`,
  ];
  const headers: HeadersInit = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/json",
    Referer: "https://www.tikwm.com/",
    Origin: "https://www.tikwm.com",
  };
  for (const api of gateways) {
    try {
      const r = await fetch(api, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      if (text.includes("Just a moment") || text.includes("_cf_chl")) continue;
      const j = JSON.parse(text) as { code?: number; data?: { play?: string; hdplay?: string; wmplay?: string }; msg?: string };
      const play = j?.data?.play || j?.data?.hdplay;
      if (play && play.startsWith("http")) return NextResponse.json({ play, hdplay: j.data?.hdplay }, { status: 200 });
    } catch {}
  }
  return NextResponse.json({ error: "No se pudo resolver sin marca. TikTok bloqueó la descarga, prueba otro enlace público." }, { status: 502 });
}
