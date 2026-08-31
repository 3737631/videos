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
    if (!r.ok) {
      const friendly = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#09090b;color:#fff"><h3>TikTok bloqueó el bot automático</h3><p>Usa el modo manual abajo: copia 1-5 enlaces de TikTok (botón Compartir → Copiar enlace) y pégalos en la web para descargar sin marca.</p><p><a href="https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}" target="_blank" style="color:#fe2c55">Abrir TikTok en pestaña nueva</a></p></body></html>`;
      return new NextResponse(friendly, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
    }
    let html = await r.text();
    // Intentar buscar vídeos reales de TikTok vía API (si falla, cae a YT)
    try {
      const apiUrl = `https://www.tiktok.com/api/search/general/full/?keyword=${encodeURIComponent(q)}&offset=0&count=6`;
      const apiR = await fetch(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: "https://www.tiktok.com/search/video?q=" + encodeURIComponent(q),
          Accept: "application/json",
        },
        cache: "no-store", signal: AbortSignal.timeout(6000),
      });
      const apiText = await apiR.text();
      if (apiText.includes('"video"') && apiText.includes('playAddr')) {
        const j = JSON.parse(apiText);
        const items = (j as { data?: unknown[] })?.data as Record<string, unknown>[] | undefined;
        if (items && items.length > 0) {
          const vids = items.slice(0,3).map((it) => {
            const v = (it as Record<string, unknown>).item as Record<string, unknown> | undefined;
            const video = (v?.video as Record<string, unknown>) || it as Record<string, unknown>;
            const play = (video.playAddr as string) || (video.downloadAddr as string) || "";
            const cover = (video.cover as string) || "";
            const id = String((v?.id as string) || (it as Record<string, unknown>).id || "");
            const author = ((v?.author as Record<string, unknown>)?.uniqueId as string) || "tiktok";
            return { id, play, cover, author };
          }).filter(v=>v.play);
          if (vids.length > 0) {
            const tiktokPage = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;background:#09090b;color:#fff;padding:16px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .card{position:relative;background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;cursor:pointer} .card video,.card img{width:100%;aspect-ratio:9/16;object-fit:cover} .badge{position:absolute;top:6px;right:6px;background:#a855f7;color:#fff;font-size:10px;padding:2px 6px;border-radius:9999px}</style></head><body><h3 style="font-size:14px;margin:0 0 12px">✓ 3 vídeos virales de "${q}" — fragmentos reales</h3><div class="grid">${vids.map(v=>`<div class="card" onclick="window.parent.postMessage({type:'TIKTOK_LINKS', links:['https://www.tiktok.com/@${v.author}/video/${v.id}']}, '*'); this.style.outline='2px solid #a855f7'"><span class="badge">✓ auto</span><video src="${v.play}" poster="${v.cover}" muted loop autoplay playsinline></video></div>`).join("")}</div><script>setTimeout(()=>{ window.parent.postMessage({type:'TIKTOK_LINKS', links:${JSON.stringify(vids.map(v=>`https://www.tiktok.com/@${v.author}/video/${v.id}`))}}, '*'); }, 900);</script></body></html>`;
            return new NextResponse(tiktokPage, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
          }
        }
      }
    } catch {}
    const hasVideoLinks = /\/video\/\d{10,}/.test(html) || html.includes('videoId');
    if (html.includes("Just a moment") || html.includes("_cf_chl") || html.length < 5000 || !hasVideoLinks) {
      // Fallback a YouTube Shorts (no bloqueado, mismo producto vertical) - siempre muestra algo por encima
      try {
        const ytR = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q + " shorts")}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "es-ES,es;q=0.9" },
          cache: "no-store", signal: AbortSignal.timeout(8000),
        });
        const ytHtml = await ytR.text();
        const ids = new Set<string>();
        const re2 = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
        let m2: RegExpExecArray | null;
        while ((m2 = re2.exec(ytHtml)) !== null) ids.add(m2[1]);
        const list = [...ids].slice(0, 6);
        if (list.length > 0) {
          const autoLinks = list.slice(0,3).map(id=>`https://www.youtube.com/watch?v=${id}`);
          const ytPage = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#09090b;color:#fff;padding:16px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .card{background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;cursor:pointer} .card img{width:100%;aspect-ratio:9/16;object-fit:cover} .card p{padding:6px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .badge{position:absolute;top:6px;right:6px;background:#a855f7;color:#fff;font-size:10px;padding:2px 6px;border-radius:9999px}</style></head><body><h3 style="font-size:14px;margin:0 0 8px">✓ 3 vídeos de "${q}" seleccionados solos</h3><p style="font-size:11px;color:#a1a1aa;margin:0 0 12px">Ya se pusieron abajo — puedes cambiar o pulsar otro</p><div class="grid" style="position:relative">${list.map((id,i)=>`<div class="card" style="position:relative" onclick="navigator.clipboard.writeText('https://www.youtube.com/watch?v=${id}'); window.parent.postMessage({type:'TIKTOK_LINKS', links:['https://www.youtube.com/watch?v=${id}']}, '*'); this.style.outline='2px solid #a855f7'">${i<3?'<span class="badge">✓ auto</span>':''}<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg"><p>${q}</p></div>`).join("")}</div><p style="margin-top:12px;font-size:11px"><a href="https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}" target="_blank" style="color:#fe2c55">Abrir TikTok real ↗</a> · También puedes pegar enlaces de YouTube abajo</p><script>setTimeout(()=>{ window.parent.postMessage({type:'TIKTOK_LINKS', links:${JSON.stringify(autoLinks)}}, '*'); }, 900);</script></body></html>`;
          return new NextResponse(ytPage, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
        }
      } catch {}
      const friendly = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#09090b;color:#fff"><h3>TikTok bloqueó el bot (Cloudflare)</h3><p>TikTok detectó modo bot. Usa el modo manual: abre TikTok en pestaña nueva, busca "${q}" y copia 1-5 enlaces de Compartir.</p><p><a href="https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}" target="_blank" style="color:#fe2c55">Abrir TikTok ↗</a></p></body></html>`;
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
