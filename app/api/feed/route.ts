import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
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
      const ytPage = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#09090b;color:#fff;font-family:system-ui} body{padding:16px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .card{position:relative;background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;cursor:pointer} .card img{width:100%;aspect-ratio:9/16;object-fit:cover;display:block} .check{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:9999px;border:2px solid rgba(255,255,255,0.6);background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff} .card.selected{border-color:#a855f7} .card.selected .check{background:#a855f7;border-color:#a855f7}</style></head><body><h3 style="font-size:14px;margin:0 0 12px">Vídeos de "${q}" — toca 2-3 (fragmentos reales YT)</h3><div class="grid" id="grid">${list.map(id=>`<div class="card" data-id="${id}" onclick="toggle(this,'${id}')"><div class="check"></div><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" loading="eager"><p>${q}</p></div>`).join("")}</div><script>
            const selected=new Set();
            function toggle(el,id){ if(selected.has(id)){selected.delete(id); el.classList.remove('selected'); el.querySelector('.check').textContent='';} else { if(selected.size>=3) return; selected.add(id); el.classList.add('selected'); el.querySelector('.check').textContent='✓'; } const links=[...selected].map(i=>'https://www.youtube.com/watch?v='+i); window.parent.postMessage({type:'TIKTOK_LINKS', links}, '*'); }
          </script></body></html>`;
      return new NextResponse(ytPage, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
    }
  } catch {}
  return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;background:#09090b;color:#fff"><h3>Buscando "${q}"</h3></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
}
