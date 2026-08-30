import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keywords") || searchParams.get("keyword") || "";
  const count = searchParams.get("count") || "8";
  if (!keyword || keyword.length < 2) return NextResponse.json({ error: "Falta keyword" }, { status: 400 });

  const encoded = encodeURIComponent(keyword);
  const target = `https://www.tikwm.com/api/feed/search?keywords=${encoded}&count=${count}&cursor=0&HD=1`;

  // Headers que ayudan a pasar Cloudflare
  const headers: HeadersInit = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.tikwm.com/",
    Origin: "https://www.tikwm.com",
  };

  try {
    const res = await fetch(target, { headers, cache: "no-store" });
    const text = await res.text();
    // Si Cloudflare devolvió challenge HTML, intentar via allorigins como fallback server-side
    if (!res.ok || text.includes("Just a moment") || text.includes("_cf_chl_opt")) {
      const fb = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`, { headers, cache: "no-store" }).catch(() => null);
      if (fb && fb.ok) {
        const t2 = await fb.text();
        try {
          const j2 = JSON.parse(t2);
          return NextResponse.json(j2, { status: 200 });
        } catch {}
        return new NextResponse(t2, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
    }
    // Intentar parsear para validar que es JSON de vídeos
    try {
      const j = JSON.parse(text);
      return NextResponse.json(j, { status: 200 });
    } catch {
      return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
