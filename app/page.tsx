"use client";
import { useState, useRef, useEffect } from "react";
import { Wand2, Loader2, Download, RefreshCcw } from "lucide-react";
import { VideoClip } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues } from "@/lib/ttsEngine";
import { analyzeProductFromImage } from "@/lib/imageAnalyze";
const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "/videos";
export default function App(){
  const [step,setStep]=useState(1);
  const [clips,setClips]=useState<VideoClip[]>([]);
  const [productPrompt,setProductPrompt]=useState("");
  const [autoProduct,setAutoProduct]=useState("");
  const [autoPhoto,setAutoPhoto]=useState<File|null>(null);
  const [autoPhotoPreview,setAutoPhotoPreview]=useState<string|null>(null);
  const photoRef=useRef<HTMLInputElement>(null);
  const [overlayOpen,setOverlayOpen]=useState(false);
  const [overlayQuery,setOverlayQuery]=useState("");
  const [status,setStatus]=useState("");
  const [progress,setProgress]=useState(0);
  const [finalVideo,setFinalVideo]=useState<string|null>(null);
  const [videoMime,setVideoMime]=useState("video/webm");
  const audioCtx=useRef<AudioContext|null>(null);
  useEffect(()=>{
    const h=async(e:MessageEvent)=>{
      if(e.data?.type==="TIKTOK_LINKS" && Array.isArray(e.data.links)){
        const links=[...new Set(e.data.links as string[])].slice(0,3);
        if(!links.length) return;
        // Crear clips YT reales sin zoom
        const clipsArr:VideoClip[]=[];
        for(const u of links){
          const id=(u.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)||[])[1]||"";
          if(!id) continue;
          try{
            const r=await fetch(`${API_BASE}/api/yt?id=${id}`,{cache:"no-store"});
            if(r.ok){
              const j=await r.json() as {url?:string};
              if(j.url){
                const res=await fetch(j.url,{cache:"no-store"});
                const blob=await res.blob();
                if(blob.size>10000){
                  const file=new File([blob],`yt-${id}.mp4`,{type:blob.type||"video/mp4"});
                  const url=URL.createObjectURL(blob);
                  const dur=await new Promise<number>(res2=>{
                    const v=document.createElement("video"); v.preload="metadata"; v.muted=true; v.playsInline=true; v.src=url;
                    let done=false; const fin=(d:number)=>{if(done) return; done=true; v.removeAttribute("src"); try{v.load()}catch{}; res2(d);};
                    v.onloadedmetadata=()=>fin(Number.isFinite(v.duration)&&v.duration>2?v.duration:6);
                    v.onerror=()=>fin(6); setTimeout(()=>fin(6),3000);
                  });
                  clipsArr.push({file, url, startOffset:0, playDuration:Math.min(7,Math.max(4,dur))});
                  continue;
                }
              }
            }
          }catch{}
          // Fallback: crear desde thumbnail sin zoom excesivo
          try{
            const thumb=`${API_BASE}/api/img?url=https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
            const blob=await (await fetch(thumb,{cache:"no-store"})).blob();
            const img=new Image(); const url=URL.createObjectURL(blob); img.src=url;
            await new Promise<void>((res,rej)=>{img.onload=()=>res(); img.onerror=()=>rej(new Error()); setTimeout(()=>rej(new Error()),2000);});
            const canvas=document.createElement("canvas"); canvas.width=640; canvas.height=1136;
            const ctx=canvas.getContext("2d",{alpha:false})!;
            const sc=Math.max(canvas.width/img.width, canvas.height/img.height);
            const w=img.width*sc, h=img.height*sc;
            ctx.drawImage(img,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
            URL.revokeObjectURL(url);
            const stream=(canvas as HTMLCanvasElement & {captureStream:(fps:number)=>MediaStream}).captureStream(24);
            const rec=new MediaRecorder(stream,{mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")?"video/webm;codecs=vp9":"video/webm"});
            const chunks:BlobPart[]=[]; rec.ondataavailable=e=>{if(e.data.size>0) chunks.push(e.data)};
            const dur=4;
            const videoUrl=await new Promise<string>((res,rej)=>{
              rec.onstop=()=>{const b=new Blob(chunks,{type:"video/webm"}); res(URL.createObjectURL(b));};
              rec.onerror=()=>rej(new Error()); rec.start();
              let s=performance.now(); const draw=()=>{
                const e=performance.now()-s;
                if(e>=dur*1000){rec.stop(); stream.getTracks().forEach(t=>t.stop()); return;}
                const p=e/(dur*1000);
                const sc2=1 + (0.5 - Math.cos(p*Math.PI)/2)*0.04;
                ctx.clearRect(0,0,canvas.width,canvas.height);
                ctx.drawImage(img,(canvas.width-w*sc2)/2,(canvas.height-h*sc2)/2,w*sc2,h*sc2);
                requestAnimationFrame(draw);
              }; draw(); setTimeout(()=>{try{if(rec.state==="recording") rec.stop()}catch{}},dur*1000+300);
            });
            const vb=await fetch(videoUrl).then(r=>r.blob());
            clipsArr.push({file: new File([vb],`yt-${id}.webm`,{type:"video/webm"}), url: videoUrl, startOffset:0, playDuration:dur});
          }catch{}
        }
        if(clipsArr.length>0){
          for(const c of clips) try{URL.revokeObjectURL(c.url)}catch{}
          setClips(clipsArr);
        }
      }
    };
    window.addEventListener("message",h);
    return ()=>window.removeEventListener("message",h);
  },[clips]);
  const openOverlay=(kw:string)=>{
    const q=kw.trim()||autoProduct.trim()||"tijeras con laser";
    if(!q||q.length<2) return;
    setOverlayQuery(q); setOverlayOpen(true);
  };
  const handlePhoto=async(files:FileList|null)=>{
    if(!files?.length) return;
    const f=files[0];
    if(!f.type.startsWith("image/")) return;
    if(autoPhotoPreview) try{URL.revokeObjectURL(autoPhotoPreview)}catch{}
    const u=URL.createObjectURL(f); setAutoPhoto(f); setAutoPhotoPreview(u);
    setStatus("Identificando...");
    try{
      const p=await analyzeProductFromImage(f,(m)=>setStatus(m));
      const isGen=!p||["web site","website","producto"].includes(p.toLowerCase())||p.length<3;
      let prod=p;
      if(isGen){
        const n=f.name.replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").slice(0,30);
        if(n&&n.length>2) prod=n; else {setStatus(""); return;}
      }
      setAutoProduct(prod); setProductPrompt(prod); openOverlay(prod);
    }catch{}
    setStatus("");
  };
  const process=async()=>{
    if(clips.length===0){ alert("Selecciona vídeos primero"); return; }
    setStep(4); setProgress(5); setStatus("Creando viral...");
    try{
      const AC=(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext || window.AudioContext;
      const ctx=new AC(); await ctx.resume(); audioCtx.current=ctx;
      const script=`Mira cómo ${productPrompt||overlayQuery} me salvó la vida. Te ahorra horas y es súper fácil. Consíguelo hoy.`;
      const tts=await generateSpeechAndCues(script,"es",ctx,(m)=>setStatus(m));
      setProgress(30); setStatus("Renderizando...");
      const {url,mimeType}=await renderFinalVideo({clips, audioBuffer:tts.audioBuffer!, audioContext:ctx, wordChunks:tts.wordChunks, mode:"voice", targetDuration:8, onProgress:(p)=>setProgress(30+Math.round(p*0.7)), isFallback:tts.isFallback});
      setVideoMime(mimeType); setFinalVideo(url); setStep(5);
    }catch(e){ alert(String(e)); setStep(2); }
  };
  const reset=()=>{
    for(const c of clips) try{URL.revokeObjectURL(c.url)}catch{}
    if(finalVideo) try{URL.revokeObjectURL(finalVideo)}catch{}
    setClips([]); setFinalVideo(null); setProductPrompt(""); setAutoProduct(""); if(autoPhotoPreview) try{URL.revokeObjectURL(autoPhotoPreview)}catch{}; setAutoPhoto(null); setAutoPhotoPreview(null); setStep(1);
  };
  return (
    <main className="flex-1 bg-[#09090b] text-white flex flex-col items-center p-4 py-8">
      <div className="w-full max-w-xl text-center mb-6">
        <h1 className="text-4xl font-black">Creador Viral</h1>
        <p className="text-xs text-zinc-500 mt-1">Vídeos virales con IA</p>
      </div>
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-[2rem] p-6 shadow-2xl">
        {step===1 && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-zinc-700 rounded-3xl p-6 flex flex-col items-center text-center space-y-3">
              <Wand2 className="w-7 h-7 text-purple-400"/>
              <h3 className="font-bold">Busca tu producto</h3>
              <div className="w-full flex gap-2">
                <input value={autoProduct} onChange={e=>setAutoProduct(e.target.value)} placeholder="ej: tijeras con laser" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-sm outline-none text-center"/>
                <button onClick={()=>openOverlay(autoProduct)} className="px-6 py-3 bg-white text-black rounded-full font-bold text-sm">Buscar</button>
              </div>
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e=>handlePhoto(e.target.files)}/>
              <button onClick={()=>photoRef.current?.click()} className="w-full py-2 bg-zinc-800 rounded-full text-xs">Subir foto</button>
              {autoPhotoPreview && <img src={autoPhotoPreview} alt="" className="w-20 h-20 rounded-xl object-cover"/>}
              {status && <p className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/>{status}</p>}
            </div>
            {clips.length>0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-center">{clips.length} vídeos listos — fragmentos reales que se mueven</p>
                <div className="grid grid-cols-3 gap-2">
                  {clips.map((c,i)=><video key={i} src={c.url} muted loop playsInline className="w-full aspect-[9/16] object-cover rounded-xl bg-black"/>)}
                </div>
                <button onClick={process} className="w-full py-3 bg-white text-black rounded-full font-bold">Crear viral con Voz</button>
              </div>
            )}
          </div>
        )}
        {step===4 && <div className="py-12 flex flex-col items-center"><div className="w-20 h-20 border-4 border-zinc-800 border-t-purple-500 rounded-full animate-spin mb-4"/><p className="text-sm">{status}</p><p className="text-xs text-zinc-500">{progress}%</p></div>}
        {step===5 && finalVideo && (
          <div className="flex flex-col items-center">
            <div className="w-[260px] h-[460px] bg-black rounded-2xl overflow-hidden border-2 border-zinc-800 mb-4"><video src={finalVideo} controls autoPlay loop playsInline className="w-full h-full object-cover"/></div>
            <div className="flex w-full gap-3"><button onClick={reset} className="flex-1 py-3 bg-zinc-800 rounded-xl font-bold flex items-center justify-center gap-2"><RefreshCcw className="w-4 h-4"/> Otro</button><a href={finalVideo} download={`viral.${videoMime.includes("mp4")?"mp4":"webm"}`} className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2"><Download className="w-4 h-4"/> Guardar</a></div>
          </div>
        )}
      </div>
      {overlayOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex flex-col p-2">
          <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col max-w-5xl w-full mx-auto">
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
              <span className="text-xs font-bold">{overlayQuery}</span>
              <button onClick={()=>setOverlayOpen(false)} className="w-8 h-8 bg-zinc-800 rounded-full">✕</button>
            </div>
            <div className="flex-1 relative bg-zinc-950">
              <iframe src={`${API_BASE}/api/feed?q=${encodeURIComponent(overlayQuery)}`} className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" title="Feed"/>
              <div className="absolute bottom-3 left-3 right-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-3 flex gap-2">
                <button onClick={()=>{
                  // El iframe ya envía TIKTOK_LINKS al seleccionar, aquí solo cerramos y creamos
                  const ev=new MessageEvent("message",{data:{type:"TIKTOK_LINKS", links:[]}});
                  // Forzar creación con clips ya existentes
                  if(clips.length>0){ setOverlayOpen(false); setTimeout(()=>process(),400); } else setOverlayOpen(false);
                }} className="flex-1 py-2 bg-white text-black rounded-full text-xs font-bold">Listo → Crear viral</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
