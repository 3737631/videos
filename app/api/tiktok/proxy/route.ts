import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const target = `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        Referer: "https://www.tiktok.com/",
      },
      cache: "no-store",
    });
    let html = await r.text();
    // Inyectar base para que recursos carguen y quitar X-Frame-Options ya lo hacemos con headers
    // Añadir pequeño helper: si detecta popup "Abrir app" lo cierra solo y enfoca buscador
    const inject = `<script>
      setTimeout(()=>{ try{
        const closeBtn = document.querySelector('[data-e2e="modal-close-inner-button"], [aria-label="Close"], button:has-text("Abrir app")');
        if(closeBtn) closeBtn.click();
        // Click en lupa si existe
        const searchInput = document.querySelector('input[type="search"], input[placeholder*="Buscar"]');
        if(searchInput){ searchInput.focus(); }
      }catch(e){} },1200);
      // Cerrar banner Abrir app
      setTimeout(()=>{ document.querySelectorAll('a,button').forEach(el=>{ if(/Abrir app/i.test(el.textContent||'')) el.style.display='none'; }); },1500);
    </script>`;
    html = html.replace("</body>", `${inject}</body>`);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "ALLOWALL",
        "Content-Security-Policy": "frame-ancestors *",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
