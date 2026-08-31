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
    // Inyectar helper: auto-cierra "Abrir app", enfoca buscador y extrae enlaces de Compartir para mandarlos al padre
    const inject = `<script>
      // Cerrar Abrir app y enfocar lupa
      setTimeout(()=>{ try{
        document.querySelectorAll('a,button').forEach(el=>{ if(/Abrir app/i.test(el.textContent||'')) el.style.display='none'; });
        const si = document.querySelector('input[type="search"], input[placeholder*="Buscar"]');
        if(si) si.focus();
      }catch(e){} },1200);
      // Bot que copia enlaces de Compartir solo
      let lastSent = 0;
      function collectAndSend(){
        try{
          const links = Array.from(document.querySelectorAll('a[href*="/video/"]')).map(a=>a.href).filter(h=>h.includes('/video/'));
          const uniq = [...new Set(links)].slice(0,5);
          if(uniq.length >= 2 && Date.now() - lastSent > 3000){
            lastSent = Date.now();
            window.parent.postMessage({ type: 'TIKTOK_LINKS', links: uniq }, '*');
          }
        }catch(e){}
      }
      setInterval(collectAndSend, 2000);
      // También observar cambios DOM
      try{ const obs = new MutationObserver(collectAndSend); obs.observe(document.body,{childList:true,subtree:true}); }catch(e){}
      // Escuchar click en lupa para forzar búsqueda
      setTimeout(()=>{ const btn = document.querySelector('button[type="submit"], [data-e2e="search-button"]'); if(btn) btn.addEventListener('click', ()=> setTimeout(collectAndSend,1500)); },1000);
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
