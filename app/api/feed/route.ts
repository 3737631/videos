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
    // Inyectar helper: proxy API, auto-cierra "Abrir app" y extrae enlaces de Compartir
    const inject = `<script>
      (function(){
        const PROXY_API = location.origin + '/videos/api/feed2?url=';
        const origFetch = window.fetch;
        window.fetch = function(input, init){
          try{
            const url = typeof input === 'string' ? input : input.url || '';
            if(url.includes('tiktok.com/api/')){
              const proxied = PROXY_API + encodeURIComponent(url);
              return origFetch.call(this, proxied, init);
            }
          }catch(e){}
          return origFetch.apply(this, arguments);
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url){
          try{ if(typeof url === 'string' && url.includes('tiktok.com/api/')) arguments[1] = PROXY_API + encodeURIComponent(url); }catch(e){}
          return origOpen.apply(this, arguments);
        };
      })();
      setTimeout(()=>{ try{
        document.querySelectorAll('a,button').forEach(el=>{ if(/Abrir app/i.test(el.textContent||'')) el.style.display='none'; });
        const si = document.querySelector('input[type="search"], input[placeholder*="Buscar"]');
        if(si) si.focus();
      }catch(e){} },1200);
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
      try{ const obs = new MutationObserver(collectAndSend); obs.observe(document.body,{childList:true,subtree:true}); }catch(e){}
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
