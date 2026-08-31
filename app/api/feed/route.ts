import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  // Página por encima que busca TikTok real vía cliente (tikwm desde tu IP, sin marca, HQ) - sin capturas
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#09090b;color:#fff;font-family:system-ui} body{padding:16px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .card{position:relative;background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;cursor:pointer} .card video{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;background:#000} .check{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:9999px;border:2px solid rgba(255,255,255,0.6);background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;z-index:2} .card.selected{border-color:#a855f7} .card.selected .check{background:#a855f7;border-color:#a855f7}</style></head><body><h3 style="font-size:14px;margin:0 0 4px">Buscando "${q}" — fragmentos reales sin marca</h3><p style="font-size:11px;color:#a1a1aa;margin:0 0 12px" id="status">Cargando vídeos limpios en alta calidad...</p><div class="grid" id="grid"><div style="padding:20px;text-align:center;color:#71717a">Buscando...</div></div><script>
    const q="${q.replace(/"/g,'\\"')}";
    const grid=document.getElementById('grid');
    const status=document.getElementById('status');
    const selected=new Map();
    function toggle(el,id,url){ if(selected.has(id)){selected.delete(id); el.classList.remove('selected'); el.querySelector('.check').textContent='';} else { if(selected.size>=3) return; selected.set(id,url); el.classList.add('selected'); el.querySelector('.check').textContent='✓'; } }
    function useSelected(){ if(selected.size===0) return; window.parent.postMessage({type:'TIKTOK_LINKS', links:[...selected.values()]}, '*'); }
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
        status.textContent='Toca 2-3 para seleccionar — fragmentos reales sin marca, HD';
        const bar=document.createElement('div'); bar.style.cssText='margin-top:16px;display:flex;gap:8px';
        bar.innerHTML='<button onclick="useSelected()" style="flex:1;padding:11px;background:#fff;color:#000;border:none;border-radius:9999px;font-weight:700;font-size:13px;cursor:pointer">Usar seleccionados</button><button onclick="window.parent.postMessage({type:\\'CLOSE_OVERLAY\\'}, \\'*\\')" style="padding:11px 16px;background:#27272a;color:#fff;border:1px solid #3f3f46;border-radius:9999px;font-size:13px">Cerrar</button>';
        document.body.appendChild(bar);
        // Auto-seleccionar 2 que coinciden y ponerlos solos si el usuario no toca
        setTimeout(()=>{ const first=[...grid.querySelectorAll('.card')].slice(0,2); first.forEach(c=>c.click()); if(selected.size>0) useSelected(); }, 1200);
      }catch(e){
        status.textContent='TikTok bloqueó — pega enlaces manualmente abajo';
        grid.innerHTML='<p style="color:#a1a1aa;font-size:12px">Copia 1-3 enlaces de TikTok (Compartir → Copiar enlace) y pégalos abajo con 📋 Pegar auto</p>';
      }
    }
    load();
  </script></body></html>`;
  return new NextResponse(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" } });
}
