import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#09090b;color:#fff;font-family:system-ui} body{padding:16px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .card{position:relative;background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;cursor:pointer} .card video{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;background:#000} .check{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:9999px;border:2px solid rgba(255,255,255,0.6);background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;z-index:2} .card.selected{border-color:#a855f7} .card.selected .check{background:#a855f7;border-color:#a855f7}</style></head><body><h3 style="font-size:14px;margin:0 0 4px">Buscando "${q}" — fragmentos reales TikTok sin marca</h3><p style="font-size:11px;color:#a1a1aa;margin:0 0 12px" id="status">Cargando vídeos limpios...</p><div class="grid" id="grid"><div style="padding:20px;text-align:center;color:#71717a">Buscando...</div></div><script>
    const q="${q.replace(/"/g,'\\"')}";
    const grid=document.getElementById('grid');
    const status=document.getElementById('status');
    const selected=new Map();
    function toggle(el,id,url){ if(selected.has(id)){selected.delete(id); el.classList.remove('selected'); el.querySelector('.check').textContent='';} else { if(selected.size>=3) return; selected.set(id,url); el.classList.add('selected'); el.querySelector('.check').textContent='✓'; } const links=[...selected.values()]; window.parent.postMessage({type:'TIKTOK_LINKS', links}, '*'); }
    async function load(){
      try{
        const r=await fetch('https://www.tikwm.com/api/feed/search?keywords='+encodeURIComponent(q)+'&count=6&cursor=0&HD=1', {cache:'no-store'});
        const j=await r.json();
        const vids=j?.data?.videos || [];
        if(!vids.length) throw new Error('no vids');
        grid.innerHTML='';
        vids.slice(0,6).forEach(v=>{
          const id=v.video_id || v.id || '';
          const play=v.play || v.hdplay || '';
          const cover=v.cover || v.origin_cover || '';
          const url='https://www.tiktok.com/@'+(v.author?.unique_id||'tiktok')+'/video/'+id;
          const card=document.createElement('div'); card.className='card'; card.onclick=()=>toggle(card, id, url);
          card.innerHTML='<div class="check"></div><video src="'+play+'" poster="'+cover+'" muted loop playsinline preload="metadata"></video>';
          grid.appendChild(card);
        });
        status.textContent='Toca 2-3 para seleccionar — fragmentos reales sin marca, se mueven';
      }catch(e){
        status.textContent='TikTok bloqueó — toca 2-3 de YouTube abajo';
        // Fallback YT si tikwm falla
        try{
          const r2=await fetch('https://www.youtube.com/results?search_query='+encodeURIComponent(q+' shorts'));
          const t=await r2.text();
          const re=/"videoId":"([a-zA-Z0-9_-]{11})"/g; let m; const ids=new Set();
          while((m=re.exec(t))!==null) ids.add(m[1]);
          const list=[...ids].slice(0,6);
          grid.innerHTML='';
          list.forEach(id=>{
            const url='https://www.youtube.com/watch?v='+id;
            const card=document.createElement('div'); card.className='card'; card.onclick=()=>toggle(card, id, url);
            card.innerHTML='<div class="check"></div><img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" style="width:100%;aspect-ratio:9/16;object-fit:cover"><p style="padding:4px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0">'+q+'</p>';
            grid.appendChild(card);
          });
        }catch{}
      }
    }
    load();
  </script></body></html>`;
  return new NextResponse(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
}
