"use client";
import { useState, useRef, useEffect } from "react";
import { UploadCloud, Wand2, Link2, Loader2, Download, RefreshCcw } from "lucide-react";
import { VideoClip } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues, generateViralMusic } from "@/lib/ttsEngine";
import { fetchTikTokClips } from "@/lib/tiktok";
import { analyzeProductFromImage } from "@/lib/imageAnalyze";

const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "/videos";

export default function App() {
  const [step, setStep] = useState(1);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [productPrompt, setProductPrompt] = useState("");
  const [language, setLanguage] = useState("es");
  const [totalDuration, setTotalDuration] = useState(10);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const [videoMimeType, setVideoMimeType] = useState("video/webm");
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);

  const [tiktokDraft, setTiktokDraft] = useState("");
  const [tiktokLinks, setTiktokLinks] = useState<string[]>([]);
  const [tiktokLoading, setTiktokLoading] = useState(false);
  const [tiktokError, setTiktokError] = useState("");
  const [autoProduct, setAutoProduct] = useState("");
  const [autoPhoto, setAutoPhoto] = useState<File | null>(null);
  const [autoPhotoPreview, setAutoPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"voice" | "music" | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayQuery, setOverlayQuery] = useState("");

  useEffect(() => { return () => { sharedAudioCtxRef.current?.close().catch(()=>{}); }; }, []);

  // Bot: escucha enlaces Compartir del iframe
  useEffect(() => {
    const h = async (e: MessageEvent) => {
      if (e.data?.type === "TIKTOK_LINKS" && Array.isArray(e.data.links)) {
        const links: string[] = [...new Set(e.data.links as string[])].slice(0,5);
        if (links.length === 0) return;
        setTiktokLinks(prev => [...new Set([...prev, ...links])].slice(0,5));
        // Auto-descargar sin tocar nada
        try {
          setTiktokLoading(true); setStatus("Bot copió enlaces de Compartir, descargando sin marca...");
          const { clips: tkClips, errors } = await fetchTikTokClips(links.join("\n"), (m)=>setStatus(m));
          if (tkClips.length > 0) {
            for (const c of clips) try{URL.revokeObjectURL(c.url)}catch{}
            setClips(tkClips);
            setTotalDuration(Math.min(15, Math.max(8, Math.round(tkClips.reduce((s,c)=>s+c.playDuration,0)))));
            setOverlayOpen(false);
            setStep(2);
            if (errors.length) setTiktokError(`Descargados ${tkClips.length} OK. Errores: ${errors.join(" | ").slice(0,200)}`);
            else setTiktokError("");
          }
        } catch (err) {
          setTiktokError(err instanceof Error ? err.message : String(err));
        } finally { setTiktokLoading(false); setStatus(""); }
      }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [clips]);

  const clearMemory = () => { for (const c of clips) try{URL.revokeObjectURL(c.url)}catch{}; if(finalVideo) try{URL.revokeObjectURL(finalVideo)}catch{}; };

  const openOverlay = (kw: string) => {
    const q = kw.trim() || autoProduct.trim() || "tijeras con laser";
    if (!q || q.length < 2) { setTiktokError("Escribe el nombre del producto"); return; }
    setOverlayQuery(q);
    setOverlayOpen(true);
    setTiktokError("");
  };

  const handlePhotoSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) { setTiktokError("Sube una foto válida"); return; }
    if (autoPhotoPreview) try{URL.revokeObjectURL(autoPhotoPreview)}catch{}
    const url = URL.createObjectURL(file);
    setAutoPhoto(file); setAutoPhotoPreview(url); setTiktokError("");
    setStatus("Identificando producto en foto...");
    try {
      const p = await analyzeProductFromImage(file, (m)=>setStatus(m));
      const isGeneric = !p || ["web site","website","producto"].includes(p.toLowerCase()) || p.length < 3;
      let product = p;
      if (isGeneric) {
        const name = file.name.replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").slice(0,30);
        if (name && name.length>2 && !/^(image|photo|img)_\d+$/i.test(name)) product = name;
        else { setTiktokError("No identifiqué el producto. Escribe su nombre y pulsa Buscar."); setStatus(""); return; }
      }
      setAutoProduct(product); setProductPrompt(product);
      openOverlay(product);
    } catch { setStatus(""); }
    setStatus("");
  };

  const handleAddLink = () => {
    const found = (tiktokDraft.match(/https?:\/\/[^\s]+/gi) || []).filter(u=>/tiktok\.com|vm\.tiktok/i.test(u));
    if (found.length===0) { setTiktokError("Solo enlaces de TikTok"); return; }
    const dedup = found.filter(u=>!tiktokLinks.includes(u));
    if (dedup.length===0) { setTiktokError("Ya añadido"); return; }
    if (tiktokLinks.length + dedup.length > 5) { setTiktokError("Máx 5"); return; }
    setTiktokLinks(prev=>[...prev, ...dedup]); setTiktokDraft(""); setTiktokError("");
  };

  const handleDownload = async () => {
    if (tiktokLinks.length===0) { setTiktokError("Añade al menos 1 enlace o usa el bot"); return; }
    setTiktokError(""); setTiktokLoading(true); setStatus("Descargando sin marca...");
    try {
      clearMemory(); if(finalVideo) { try{URL.revokeObjectURL(finalVideo)}catch{}; setFinalVideo(null); }
      const { clips: tkClips, errors } = await fetchTikTokClips(tiktokLinks.join("\n"), (m)=>setStatus(m));
      setClips(tkClips);
      setTotalDuration(Math.min(15, Math.max(8, Math.round(tkClips.reduce((s,c)=>s+c.playDuration,0)))));
      if (errors.length) setTiktokError(`Descargados ${tkClips.length} OK. Errores: ${errors.join(" | ").slice(0,200)}`);
      setStep(2); setStatus("");
    } catch(e){ setTiktokError(e instanceof Error ? e.message : String(e)); }
    finally { setTiktokLoading(false); setStatus(""); }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    clearMemory();
    const arr = Array.from(files).filter(f=>f.type.startsWith("video/"));
    if (!arr.length) { alert("Sube vídeos"); return; }
    const valid: VideoClip[] = []; let acc=0;
    for (const file of arr) {
      const url = URL.createObjectURL(file);
      const dur = await new Promise<number>(res=>{
        const v=document.createElement("video"); v.preload="metadata"; v.muted=true; v.playsInline=true; v.src=url;
        let done=false; const fin=(d:number)=>{ if(done) return; done=true; v.removeAttribute("src"); try{v.load()}catch{}; res(d); };
        v.onloadedmetadata=()=>fin(Number.isFinite(v.duration)&&v.duration>0.5?v.duration:3);
        v.onerror=()=>fin(3); setTimeout(()=>fin(3),2500);
      });
      valid.push({ file, url, startOffset:0, playDuration:dur }); acc+=dur;
    }
    setClips(valid.sort(()=>Math.random()-0.5));
    setTotalDuration(Math.min(15,Math.max(8,Math.round(acc))));
    setStep(2);
  };

  const generateScriptLocal = (info: string, lang: string, targetDuration=9) => {
    const raw = info.replace(/https?:\/\/\S+/g,"").trim() || "este producto";
    const kw = raw.split(/\s+/).filter(w=>w.length>2).slice(0,3).join(" ").slice(0,22) || raw.slice(0,18);
    const lower=raw.toLowerCase();
    const isCleaner=/limpia|mancha|suci|jab[oó]n/.test(lower);
    const benefits = isCleaner ? "Elimina manchas y grasa en segundos sin frotar." : "Te ahorra horas de esfuerzo y es súper fácil.";
    const hooks = lang==="es" ? `¿Cansado de los mismos problemas? Necesitas ${kw}.` : `You need ${kw}.`;
    const calls = lang==="es" ? "Consíguelo hoy." : "Get it today.";
    let full = `${hooks} ${benefits} ${calls}`;
    const max = targetDuration<=6?110:targetDuration<=8?150:targetDuration<=10?190:240;
    if (full.length>max) full=full.slice(0, max).trim()+".";
    return full;
  };

  const processVideo = async () => {
    setStep(4); setProgress(5); setStatus("Activando audio...");
    try {
      const AC = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      const ctx = new AC(); await ctx.resume(); sharedAudioCtxRef.current=ctx;
      let audioBuffer: AudioBuffer | null=null; let wordChunks:string[]=[]; let isFallback=false;
      setProgress(15);
      if (mode==="voice") {
        setStatus(`Generando voz en ${language.toUpperCase()}...`);
        const script=generateScriptLocal(productPrompt, language, totalDuration);
        const tts=await generateSpeechAndCues(script, language, ctx, (m)=>setStatus(m));
        audioBuffer=tts.audioBuffer; wordChunks=tts.wordChunks; isFallback=tts.isFallback;
      } else { setStatus("Generando música..."); audioBuffer=await generateViralMusic(totalDuration); }
      setProgress(30); setStatus("Renderizando a 30 FPS...");
      const { url, mimeType } = await renderFinalVideo({ clips, audioBuffer, audioContext: ctx, wordChunks, mode: mode!, targetDuration: totalDuration, onProgress:(p)=>setProgress(30+Math.round(p*0.7)), isFallback });
      setVideoMimeType(mimeType); setFinalVideo(url); setStep(5);
    } catch(e){ alert(`Error: ${e instanceof Error ? e.message : String(e)}`); setStep(3); }
  };

  const resetAll = () => {
    clearMemory(); setClips([]); setFinalVideo(null); setProductPrompt(""); setTiktokDraft(""); setTiktokLinks([]); setTiktokError("");
    setAutoProduct(""); if(autoPhotoPreview) try{URL.revokeObjectURL(autoPhotoPreview)}catch{}; setAutoPhoto(null); setAutoPhotoPreview(null);
    setMode(null); setLanguage("es"); setTotalDuration(10); setProgress(0); setStatus(""); setVideoMimeType("video/webm");
    sharedAudioCtxRef.current?.close().catch(()=>{}); sharedAudioCtxRef.current=null; setStep(1); setOverlayOpen(false);
  };

  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <main className="flex-1 bg-[#09090b] text-white flex flex-col items-center p-4 sm:p-6 py-8">
      <div className="w-full max-w-xl text-center mb-6">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-xs font-bold mb-3 tracking-widest">CREADOR VIRAL — BOT TIKTOK</div>
        <h1 className="text-4xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">Creador Viral</h1>
        <p className="text-xs text-zinc-500 mt-2">Bot abre TikTok por encima, pulsa solo y copia enlaces de Compartir</p>
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-[2rem] p-5 sm:p-8 shadow-2xl">
        {step===1 && (
          <div className="space-y-5">
            <div className="border-2 border-dashed border-zinc-700 bg-zinc-950/50 rounded-3xl p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center"><Wand2 className="w-7 h-7 text-purple-400"/></div>
              <h3 className="font-bold">Modo Automático — Bot TikTok</h3>
              <p className="text-xs text-zinc-500">Escribe producto o sube foto y el bot abrirá TikTok solo</p>
              <div className="w-full flex gap-2">
                <input value={autoProduct} onChange={e=>setAutoProduct(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") openOverlay(autoProduct)}} placeholder="ej: tijeras con laser" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-sm focus:border-zinc-600 outline-none text-center"/>
                <button onClick={()=>openOverlay(autoProduct)} className="px-6 py-3 bg-white text-black rounded-full font-bold text-sm hover:bg-zinc-100">Buscar</button>
              </div>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={e=>handlePhotoSelect(e.target.files)}/>
              <button onClick={()=>photoInputRef.current?.click()} className="w-full py-2.5 bg-zinc-900 border border-zinc-800 rounded-full text-xs flex items-center justify-center gap-2"><UploadCloud className="w-4 h-4"/> {autoPhoto ? "Cambiar foto" : "Subir foto del producto"}</button>
              {autoPhotoPreview && <div className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-2"><img src={autoPhotoPreview} alt="" className="w-14 h-14 rounded-xl object-cover"/><span className="flex-1 text-xs truncate text-left">{autoPhoto?.name}</span><button onClick={()=>{if(autoPhotoPreview) URL.revokeObjectURL(autoPhotoPreview); setAutoPhoto(null); setAutoPhotoPreview(null);}} className="w-7 h-7 bg-zinc-800 rounded-full">✕</button></div>}
              <button onClick={()=>openOverlay(autoProduct)} className="w-full py-2.5 bg-[#fe2c55] hover:bg-[#e0264d] rounded-full text-white text-xs font-bold">Abrir TikTok por encima ↗ — bot pulsará solo</button>
              {tiktokError && <div className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{tiktokError}</div>}
              {status && <div className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/>{status}</div>}
              {tiktokLoading && <div className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/>Descargando sin marca...</div>}
            </div>

            <div className="border-2 border-dashed border-zinc-700 bg-zinc-950/50 rounded-3xl p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center"><Link2 className="w-7 h-7 text-cyan-400"/></div>
              <h3 className="font-bold text-sm">O pega enlaces de Compartir manualmente</h3>
              <p className="text-xs text-zinc-500">Si el bot no pudo, pega 1-5 enlaces de TikTok</p>
              <div className="w-full flex gap-2">
                <input value={tiktokDraft} onChange={e=>setTiktokDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") handleAddLink()}} placeholder="https://www.tiktok.com/@user/video/..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-xs outline-none text-center"/>
                <button onClick={handleAddLink} className="px-6 py-3 bg-white text-black rounded-full font-bold text-sm">Añadir</button>
              </div>
              {tiktokLinks.length>0 && <div className="w-full space-y-2 max-h-[140px] overflow-y-auto">{tiktokLinks.map((l,i)=><div key={i} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2 text-xs"><span className="flex-1 truncate text-left">{l}</span><button onClick={()=>setTiktokLinks(p=>p.filter((_,k)=>k!==i))} className="w-6 h-6 bg-zinc-800 rounded-full">✕</button></div>)}</div>}
              <button onClick={handleDownload} disabled={tiktokLoading || tiktokLinks.length===0} className="w-full py-3 bg-white text-black rounded-full font-bold text-sm disabled:opacity-40">Descargar sin marca ↓</button>
              {tiktokError && <div className="w-full rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{tiktokError}</div>}
            </div>

            <div className="border border-zinc-800 rounded-3xl p-6 flex flex-col items-center text-center space-y-3">
              <h3 className="font-bold text-sm">O sube tus vídeos</h3>
              <input ref={fileInput} type="file" accept="video/*" multiple className="hidden" onChange={e=>handleUpload(e.target.files)}/>
              <button onClick={()=>fileInput.current?.click()} className="w-full py-3 bg-zinc-800 rounded-full font-bold text-sm">Seleccionar vídeos</button>
            </div>
          </div>
        )}

        {step===2 && (
          <div className="space-y-4">
            <h3 className="font-bold text-center">Elige modo</h3>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={()=>setMode("voice")} className={`p-4 rounded-2xl border-2 ${mode==="voice"?"border-purple-500 bg-purple-500/10":"border-zinc-800 bg-zinc-950"}`}>🎙️ Voz</button>
              <button onClick={()=>setMode("music")} className={`p-4 rounded-2xl border-2 ${mode==="music"?"border-purple-500 bg-purple-500/10":"border-zinc-800 bg-zinc-950"}`}>🎵 Música</button>
            </div>
            {mode && (
              <div className="space-y-3">
                <textarea value={productPrompt} onChange={e=>setProductPrompt(e.target.value)} placeholder="Describe tu producto para el guion" className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-3 text-sm h-20 outline-none"/>
                <div className="flex gap-2">
                  <select value={language} onChange={e=>setLanguage(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded-full px-3 py-2 text-sm"><option value="es">ES</option><option value="en">EN</option><option value="pt">PT</option><option value="fr">FR</option></select>
                  <select value={totalDuration} onChange={e=>setTotalDuration(Number(e.target.value))} className="flex-1 bg-zinc-950 border border-zinc-800 rounded-full px-3 py-2 text-sm"><option value={7}>7s</option><option value={10}>10s</option><option value={15}>15s</option></select>
                </div>
                <button onClick={processVideo} className="w-full py-3 bg-white text-black rounded-full font-bold">Crear Vídeo</button>
              </div>
            )}
          </div>
        )}

        {step===4 && <div className="py-12 flex flex-col items-center"><div className="w-20 h-20 border-4 border-zinc-800 border-t-purple-500 rounded-full animate-spin mb-4"/><p className="text-sm">{status}</p><p className="text-xs text-zinc-500">{progress}%</p></div>}
        {step===5 && finalVideo && (
          <div className="flex flex-col items-center">
            <div className="w-[260px] h-[460px] bg-black rounded-2xl overflow-hidden border-2 border-zinc-800 mb-4"><video src={finalVideo} controls autoPlay loop playsInline className="w-full h-full object-cover"/></div>
            <div className="flex w-full gap-3"><button onClick={resetAll} className="flex-1 py-3 bg-zinc-800 rounded-xl font-bold flex items-center justify-center gap-2"><RefreshCcw className="w-4 h-4"/> Otro</button><a href={finalVideo} download={`viral.${videoMimeType.includes("mp4")?"mp4":"webm"}`} className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2"><Download className="w-4 h-4"/> Guardar</a></div>
            <button onClick={async()=>{ try{ const r=await fetch(finalVideo); const b=await r.blob(); const f=new File([b],`viral.${videoMimeType.includes("mp4")?"mp4":"webm"}`,{type:b.type}); if((navigator as unknown as {canShare:(d:unknown)=>boolean}).canShare?.({files:[f]})) await (navigator as unknown as {share:(d:unknown)=>Promise<void>}).share({files:[f], title:"Viral"}); else window.open("https://www.tiktok.com/upload","_blank"); }catch{ window.open("https://www.tiktok.com/upload","_blank"); } }} className="w-full mt-3 py-3 bg-black border border-zinc-800 rounded-full font-bold text-sm">Compartir en TikTok ↗</button>
          </div>
        )}
      </div>

      {overlayOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex flex-col p-2 sm:p-4">
          <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col max-w-5xl w-full mx-auto">
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
              <span className="text-xs font-bold">TikTok — &quot;{overlayQuery}&quot; — bot pulsando solo</span>
              <button onClick={()=>setOverlayOpen(false)} className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center">✕</button>
            </div>
            <div className="flex-1 relative bg-white">
              <iframe src={`${API_BASE}/api/tiktok/proxy/?q=${encodeURIComponent(overlayQuery)}`} className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" title="TikTok"/>
              <div className="absolute bottom-3 left-3 right-3 bg-zinc-950/95 border border-zinc-800 rounded-2xl p-3 flex gap-2">
                <span className="flex-1 text-xs text-zinc-400">Bot copiando enlaces de Compartir solo...</span>
                <button onClick={()=>setOverlayOpen(false)} className="px-4 py-2 bg-zinc-800 rounded-full text-xs font-bold">Cancelar</button>
                <button onClick={()=>setOverlayOpen(false)} className="px-4 py-2 bg-white text-black rounded-full text-xs font-bold">Listo</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
