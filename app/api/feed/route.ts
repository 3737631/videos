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
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      const friendly = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#09090b;color:#fff"><h3>TikTok bloqueó el bot automático</h3><p>Usa el modo manual abajo: copia 1-5 enlaces de TikTok (botón Compartir → Copiar enlace) y pégalos en la web para descargar sin marca.</p><p><a href="https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}" target="_blank" style="color:#fe2c55">Abrir TikTok en pestaña nueva</a></p></body></html>`;
      return new NextResponse(friendly, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
    }
    let html = await r.text();
    const hasVideoLinks = /\/video\/\d{10,}/.test(html) || html.includes('videoId');
    if (html.includes("Just a moment") || html.includes("_cf_chl") || html.length < 5000 || !hasVideoLinks) {
      const friendly = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#09090b;color:#fff"><h3>Buscando "${q}"</h3><p style="color:#a1a1aa">TikTok está cargando... Si ves TikTok por encima, pulsa solo la lupa y copia 1-3 enlaces de <b>Compartir → Copiar enlace</b>.</p><p>Los vídeos se pondrán abajo <b>limpios y en alta calidad</b> (sin marca) vía copia de enlace.</p><p><a href="https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}" target="_blank" style="color:#fe2c55">Abrir TikTok en pestaña nueva ↗</a></p><p style="font-size:11px;color:#71717a">Vuelve aquí y pulsa <b>📋 Pegar automáticamente</b> abajo.</p></body></html>`;
      return new NextResponse(friendly, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
    }
    // Quitar bloqueos anti-iframe de TikTok
    html = html.replace(/<meta[^>]*http-equiv=["']X-Frame-Options["'][^>]*>/gi, "");
    html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
    // Inyectar helper: anti-frame-busting + proxy API + auto-cierra
    const inject = `<script>
      // Anti frame-busting
      try { window.top = window.self; } catch(e){}
      window.__isInIframe = true;
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
          if(uniq.length >= 2 && Date.now() - lastSent > 8000){
            lastSent = Date.now();
            // Pequeño delay humano antes de enviar
            setTimeout(()=> window.parent.postMessage({ type: 'TIKTOK_LINKS', links: uniq }, '*'), 800 + Math.random()*1200);
          }
        }catch(e){}
      }
      // Poll humano: cada 4-6s aleatorio, no cada 2s (evita bloqueo bot)
      setInterval(collectAndSend, 4500 + Math.random()*1500);
      try{ const obs = new MutationObserver(()=>{ if(Math.random()>0.7) collectAndSend(); }); obs.observe(document.body,{childList:true,subtree:true}); }catch(e){}
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
