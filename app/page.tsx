"use client";
import { useState, useRef, useEffect } from "react";
import { UploadCloud, Wand2, Link2, Loader2, Download, RefreshCcw, Mic, Music2, Check, Sparkles, X } from "lucide-react";
import { VideoClip } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues, generateViralMusic } from "@/lib/ttsEngine";
import { fetchTikTokClips } from "@/lib/tiktok";
import { analyzeProductFromImage } from "@/lib/imageAnalyze";

const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "/videos";

export default function App() {
  const [step, setStep] = useState(1);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const clipsRef = useRef<VideoClip[]>([]);
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

  // Bot: escucha enlaces del iframe - manual, limpio, ético
  useEffect(() => {
    const h = async (e: MessageEvent) => {
      if (e.data?.type === "CLOSE_OVERLAY") { setOverlayOpen(false); return; }
      if (e.data?.type === "TIKTOK_LINKS" && Array.isArray(e.data.links)) {
        const links: string[] = [...new Set(e.data.links as string[])].slice(0,5);
        if (links.length === 0) return;
        setTiktokLinks(prev => [...new Set([...prev, ...links])].slice(0,5));
        setTiktokError("");
        return;
      }    };
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

  const handleAutoPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const found = (text.match(/https?:\/\/[^\s]+/gi) || []).filter(u=>/tiktok\.com|vm\.tiktok/i.test(u));
      if (found.length===0) { setTiktokError("Copia primero un enlace de TikTok (Compartir → Copiar enlace)"); return; }
      const dedup = found.filter(u=>!tiktokLinks.includes(u)).slice(0,5 - tiktokLinks.length);
      if (dedup.length===0) { setTiktokError("Ya añadido"); return; }
      setTiktokLinks(prev=>[...prev, ...dedup]);
      setTiktokError("");
      // Auto-descargar sin tocar más
      setTimeout(()=> handleDownload(), 400);
    } catch {
      setTiktokError("Da permiso de portapapeles y vuelve a pulsar");
    }
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
    const found = (tiktokDraft.match(/https?:\/\/[^\s]+/gi) || []).filter(u=>/tiktok\.com|vm\.tiktok|youtube\.com|youtu\.be/i.test(u));
    if (found.length===0) { setTiktokError("Solo enlaces de TikTok o YouTube"); return; }
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
      const ytLinks = tiktokLinks.filter(u=>/youtube\.com|youtu\.be/i.test(u));
      const tkLinks = tiktokLinks.filter(u=>/tiktok\.com|vm\.tiktok/i.test(u));
      const allClips: VideoClip[] = [];
      const allErrors: string[] = [];
      if (ytLinks.length > 0) {
        for (const url of ytLinks) {
          const vid = (/(?:v=|shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url) || [])[1] || "";
          if (!vid) { allErrors.push(url+": ID no válido"); continue; }
          let ok = false;
          try {
            setStatus(`Descargando ${vid} sin marca (directo)...`);
            const r = await fetch(`${API_BASE}/api/yt?id=${vid}`, { cache: "no-store" });
            const ct = r.headers.get("content-type") || "";
            if (r.ok && !ct.includes("application/json")) {
              const blob = await r.blob();
              if (blob.size > 10000) {
                const file = new File([blob], `yt-${vid}.mp4`, { type: blob.type || "video/mp4" });
                const blobUrl = URL.createObjectURL(blob);
                const dur = await new Promise<number>(res2 => {
                  const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.playsInline = true; v.src = blobUrl;
                  let done = false; const fin = (d: number) => { if (done) return; done = true; v.removeAttribute("src"); try { v.load() } catch {} res2(d); };
                  v.onloadedmetadata = () => fin(Number.isFinite(v.duration) && v.duration > 2 ? v.duration : 6);
                  v.onerror = () => fin(6); setTimeout(() => fin(6), 3000);
                });
                allClips.push({ file, url: blobUrl, startOffset: 0, playDuration: Math.min(7, Math.max(4, dur)) });
                ok = true;
              }
            }
          } catch {}
          if (!ok) {
            let ghErr = "";
            try {
              setStatus(`YouTube bloqueó el servidor directo. Descargando ${vid} por vía alternativa: puede tardar 2-4 min, no cierres la página...`);
              const s = await fetch(`${API_BASE}/api/yt-gh?start=1&id=${vid}`, { cache: "no-store" });
              const sj = await s.json();
              if (sj.runId) {
                let done = false;
                for (let i = 0; i < 45; i++) {
                  await new Promise(r2 => setTimeout(r2, 8000));
                  const p = await fetch(`${API_BASE}/api/yt-gh?run=${sj.runId}`, { cache: "no-store" });
                  const pj = await p.json();
                  if (pj.status === "completed") { done = true; if (pj.conclusion === "success") {} break; }
                  if (pj.conclusion && pj.conclusion !== "success") { done = true; break; }
                }
                for (let attempt = 0; attempt < 4; attempt++) {
                  setStatus(`Descargando ${vid} por vía alternativa... (2-4 min, no cierres la página)`);
                  const r2 = await fetch(`${API_BASE}/api/yt-gh?run=${sj.runId}&art=1&id=${vid}`, { cache: "no-store" });
                  const ct2 = r2.headers.get("content-type") || "";
                  if (r2.ok && !ct2.includes("application/json")) {
                    const blob = await r2.blob();
                    if (blob.size > 10000) {
                      const file = new File([blob], `yt-${vid}.mp4`, { type: blob.type || "video/mp4" });
                      const blobUrl = URL.createObjectURL(blob);
                      const dur = await new Promise<number>(res2 => {
                        const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.playsInline = true; v.src = blobUrl;
                        let done2 = false; const fin = (d: number) => { if (done2) return; done2 = true; v.removeAttribute("src"); try { v.load() } catch {} res2(d); };
                        v.onloadedmetadata = () => fin(Number.isFinite(v.duration) && v.duration > 2 ? v.duration : 6);
                        v.onerror = () => fin(6); setTimeout(() => fin(6), 3000);
                      });
                      allClips.push({ file, url: blobUrl, startOffset: 0, playDuration: Math.min(7, Math.max(4, dur)) });
                      ok = true; break;
                    }
                  }
                  await new Promise(r3 => setTimeout(r3, 5000));
                }
                if (!ok) ghErr = "artefacto no disponible";
              } else { ghErr = (sj.error || "sin run") as string; }
            } catch (e) { ghErr = String(e); }
            if (!ok) allErrors.push(ghErr ? `${url} (${ghErr.slice(0, 80)})` : url);
          }
        }
      }
      if (tkLinks.length > 0) {
        const { clips: tkClips, errors: tkErrors } = await fetchTikTokClips(tkLinks.join("\n"), (m) => setStatus(m));
        allClips.push(...tkClips);
        allErrors.push(...tkErrors);
      }
      if (allClips.length === 0) {
        if (allErrors.some(e => e.includes("YT_BLOCKED") || e.includes("GitHub"))) {
          throw new Error("YouTube ha bloqueado el servidor. Descarga el vídeo con: node yt-local.mjs \"https://www.youtube.com/shorts/ID\" y súbelo en 'O sube tus vídeos'.");
        }
        throw new Error(allErrors.join("\n") || "No se pudo descargar ningún vídeo");
      }
      clipsRef.current = allClips; setClips(allClips);
      setTotalDuration(Math.min(15, Math.max(8, Math.round(allClips.reduce((s,c)=>s+c.playDuration,0)))));
      if (allErrors.length) setTiktokError(`Descargados ${allClips.length} OK. Errores: ${allErrors.join(" | ").slice(0,200)}`);
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

  const processVideo = async (forceMode?: unknown) => {
    const m = (typeof forceMode === "string" && (forceMode==="voice"||forceMode==="music") ? forceMode : null) as "voice"|"music"|null;
    const useMode = m || mode || "voice";
    setMode(useMode);
    setStep(4); setProgress(5); setStatus("Activando audio...");
    try {
      const AC = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      const ctx = new AC(); await ctx.resume(); sharedAudioCtxRef.current=ctx;
      let audioBuffer: AudioBuffer | null=null; let wordChunks:string[]=[]; let isFallback=false;
      setProgress(15);
      if (useMode==="voice") {
        setStatus(`Generando voz en ${language.toUpperCase()}...`);
        const script=generateScriptLocal(productPrompt, language, totalDuration);
        const tts=await generateSpeechAndCues(script, language, ctx, (m)=>setStatus(m));
        audioBuffer=tts.audioBuffer; wordChunks=tts.wordChunks; isFallback=tts.isFallback;
      } else { setStatus("Generando música..."); audioBuffer=await generateViralMusic(totalDuration); }
      const useClips = clips.length>0 ? clips : clipsRef.current;
      if (useClips.length===0) throw new Error("No hay clips de vídeo.");
      setProgress(30); setStatus("Renderizando a 30 FPS...");
      const { url, mimeType } = await renderFinalVideo({ clips: useClips, audioBuffer, audioContext: ctx, wordChunks, mode: mode!, targetDuration: totalDuration, onProgress:(p)=>setProgress(30+Math.round(p*0.7)), isFallback });
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

  const linkChip = (link: string, onRemove: () => void) => (
    <div key={link} className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs">
      <span className="flex-1 truncate text-left text-zinc-300">{link}</span>
      <button onClick={onRemove} aria-label="Quitar enlace" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-300 transition-colors hover:bg-white/20 hover:text-white"><X className="h-3 w-3" /></button>
    </div>
  );

  const fieldClass = "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-500/30";

  const errorBox = (msg: string) => (
    <div role="alert" className="w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-300">{msg}</div>
  );

  const loadingLine = (msg: string) => (
    <div className="flex w-full items-center justify-start gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{msg}</div>
  );

  return (
    <main className="relative flex flex-1 flex-col items-center overflow-hidden bg-[#08080b] px-4 pb-16 pt-10 text-white sm:px-6 sm:pt-14">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute -top-44 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-purple-600/25 blur-[130px]" />
        <div className="absolute -right-36 top-44 h-[400px] w-[400px] rounded-full bg-fuchsia-600/15 blur-[120px]" />
        <div className="absolute -left-36 bottom-0 h-[380px] w-[380px] rounded-full bg-pink-600/15 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-3xl">
        <header className="mb-8 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-fuchsia-300 shadow-[0_0_44px_-12px_rgba(217,70,239,0.6)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gradient-to-r from-fuchsia-400 to-pink-500 motion-reduce:animate-none" />
            Creador Viral
          </div>
          <h1 className="text-4xl font-black leading-[1.04] tracking-tight sm:text-6xl">
            <span className="bg-gradient-to-b from-white via-white to-zinc-500 bg-clip-text text-transparent">Tus vídeos se vuelven </span>
            <span className="bg-gradient-to-r from-fuchsia-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">virales</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-zinc-400 sm:text-base">
            Deja sin marca cualquier vídeo de TikTok o YouTube y añade voz, subtítulos o música en segundos.
          </p>
        </header>

        {step > 1 && (
          <nav aria-label="Progreso" className="mb-6 flex items-center justify-center gap-2 sm:gap-3">
            {[
              { n: 1, label: "Tu vídeo", state: step === 1 ? "current" : "done" },
              { n: 2, label: "Estilo", state: step === 2 ? "current" : step > 2 ? "done" : "todo" },
              { n: 3, label: "Vídeo final", state: step === 5 ? "current" : step > 2 ? "running" : "todo" },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 sm:gap-3">
                {i > 0 && <div className={`h-px w-6 sm:w-10 ${s.state === "todo" ? "bg-white/10" : "bg-gradient-to-r from-fuchsia-500 to-pink-500"}`} />}
                <div className="flex flex-col items-center gap-1.5">
                  <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${s.state === "done" ? "bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white" : s.state === "current" ? "border border-fuchsia-400 text-fuchsia-300" : s.state === "running" ? "border border-white/20 text-zinc-300" : "border border-white/15 text-zinc-500"}`}>
                    {s.state === "done" ? "✓" : s.n}
                  </span>
                  <span className={`text-[10px] font-semibold tracking-wide ${s.state === "todo" ? "text-zinc-600" : "text-zinc-300"}`}>{s.label}</span>
                </div>
              </div>
            ))}
          </nav>
        )}

        <div className="relative z-10 rounded-[28px] border border-white/10 bg-[#0d0d12]/90 p-5 shadow-[0_24px_80px_-24px_rgba(168,85,247,0.25)] backdrop-blur-sm sm:p-8">
          {step === 1 && (
            <div className="space-y-4">
              <div className="mb-2">
                <h2 className="text-lg font-bold tracking-tight">1 · Elige la fuente de tu vídeo</h2>
                <p className="mt-1 text-xs text-zinc-500">Sin marca, listo para hacerlo viral. Elige una de estas opciones.</p>
              </div>

              {/* Bot automático TikTok — card principal */}
              <section className="rounded-3xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/[0.08] via-purple-500/[0.05] to-transparent p-5 text-left sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-[0_8px_24px_-8px_rgba(217,70,239,0.7)]">
                    <Wand2 className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">Bot TikTok — automático</h3>
                    <p className="mt-0.5 text-xs text-zinc-400">Escribe el producto y el bot abre TikTok y copia los mejores vídeos.</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <input
                    value={autoProduct}
                    onChange={e=>setAutoProduct(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter") openOverlay(autoProduct)}}
                    placeholder="ej: tijeras con láser"
                    aria-label="Nombre del producto"
                    className={fieldClass}
                  />
                  <button onClick={()=>openOverlay(autoProduct)} className="shrink-0 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-zinc-200">
                    Buscar
                  </button>
                </div>

                <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={e=>handlePhotoSelect(e.target.files)} />
                <button onClick={()=>photoInputRef.current?.click()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/30 py-2.5 text-xs text-zinc-300 transition-colors hover:border-white/25 hover:text-white">
                  <UploadCloud className="h-4 w-4" /> {autoPhoto ? "Cambiar foto" : "…o sube una foto del producto"}
                </button>

                {autoPhotoPreview && (
                  <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-2">
                    <img src={autoPhotoPreview} alt="" className="h-14 w-14 rounded-xl object-cover" />
                    <span className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300">{autoPhoto?.name}</span>
                    <button onClick={()=>{if(autoPhotoPreview) URL.revokeObjectURL(autoPhotoPreview); setAutoPhoto(null); setAutoPhotoPreview(null);}} aria-label="Quitar foto" className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:bg-white/20 hover:text-white"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )}

                <p className="mt-3 text-left text-[11px] text-zinc-500">Con la foto o el nombre detectamos vídeos relacionados automáticamente.</p>
                {tiktokError && <div className="mt-3">{errorBox(tiktokError)}</div>}
                {status && <div className="mt-3">{loadingLine(status)}</div>}
                {tiktokLoading && !status && <div className="mt-3">{loadingLine("Descargando sin marca...")}</div>}
              </section>

              {/* Enlaces de TikTok */}
              <div className="grid gap-4 sm:grid-cols-1">
                <section className="flex flex-col rounded-3xl border border-cyan-500/20 bg-gradient-to-b from-cyan-500/[0.05] to-transparent p-5 text-left">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-600">
                      <Link2 className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold">Enlaces</h3>
                      <p className="text-xs text-zinc-400">Pega 1-5 enlaces de TikTok o YouTube.</p>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <input
                      value={tiktokDraft}
                      onChange={e=>setTiktokDraft(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter") handleAddLink()}}
                      placeholder="https://www.tiktok.com/@user/video/..."
                      aria-label="Enlace de TikTok"
                      className={fieldClass}
                    />
                    <button onClick={handleAddLink} className="shrink-0 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500">
                      + Añadir
                    </button>
                  </div>

                  {tiktokLinks.length>0 && <div className="mt-3 space-y-2">{tiktokLinks.map((l,i)=>linkChip(l, ()=>setTiktokLinks(p=>p.filter((_,k)=>k!==i))))}</div>}
                  {tiktokError && <div className="mt-3">{errorBox(tiktokError)}</div>}
                  {tiktokLoading && <div className="mt-3">{loadingLine("Descargando sin marca...")}</div>}
                  <button onClick={handleDownload} disabled={tiktokLoading || tiktokLinks.length===0} className="mt-auto pt-4">
                    <span className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600">
                      <Download className="h-4 w-4" /> Descargar sin marca
                    </span>
                  </button>
                </section>
              </div>

              {/* Subir vídeos */}
              <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 text-left">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                      <UploadCloud className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold">O sube tus vídeos</h3>
                      <p className="text-xs text-zinc-400">Usa clips propios que ya tengas guardados.</p>
                    </div>
                  </div>
                  <input ref={fileInput} type="file" accept="video/*" multiple className="hidden" onChange={e=>handleUpload(e.target.files)} />
                  <button onClick={()=>fileInput.current?.click()} className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-zinc-200">
                    Seleccionar vídeos
                  </button>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold tracking-tight">2 · Elige el estilo</h2>
                <p className="mt-1 text-xs text-zinc-500">Cómo quieres que se oiga tu vídeo viral.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button onClick={()=>setMode("voice")} aria-pressed={mode==="voice"} className={`group relative flex flex-col items-start gap-3 rounded-3xl border p-5 text-left transition-all ${mode==="voice" ? "border-fuchsia-500/70 bg-gradient-to-br from-fuchsia-500/15 to-purple-500/5 shadow-[0_0_40px_-10px_rgba(217,70,239,0.5)]" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}>
                  {mode==="voice" && <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-pink-500"><Check className="h-3.5 w-3.5 text-white" /></span>}
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${mode==="voice" ? "bg-gradient-to-br from-fuchsia-500 to-pink-500" : "bg-white/10 group-hover:bg-white/15"}`}><Mic className="h-6 w-6 text-white" /></span>
                  <span className="text-base font-bold">Voz</span>
                  <span className="text-left text-xs text-zinc-400">Narración con IA afirmativa y subtítulos en pantalla.</span>
                </button>
                <button onClick={()=>setMode("music")} aria-pressed={mode==="music"} className={`group relative flex flex-col items-start gap-3 rounded-3xl border p-5 text-left transition-all ${mode==="music" ? "border-fuchsia-500/70 bg-gradient-to-br from-fuchsia-500/15 to-purple-500/5 shadow-[0_0_40px_-10px_rgba(217,70,239,0.5)]" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}>
                  {mode==="music" && <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-pink-500"><Check className="h-3.5 w-3.5 text-white" /></span>}
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${mode==="music" ? "bg-gradient-to-br from-fuchsia-500 to-pink-500" : "bg-white/10 group-hover:bg-white/15"}`}><Music2 className="h-6 w-6 text-white" /></span>
                  <span className="text-base font-bold">Música</span>
                  <span className="text-left text-xs text-zinc-400">Ritmo pegadizo sin texto, ideal para mostrar solo el producto.</span>
                </button>
              </div>

              {mode && (
                <div className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-5">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-zinc-300">Describe tu producto para el guión</span>
                    <textarea value={productPrompt} onChange={e=>setProductPrompt(e.target.value)} placeholder="ej: tijeras con láser de precisión que cortan cualquier material" className={`${fieldClass} h-20 resize-none`} />
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs font-semibold text-zinc-300">Idioma</span>
                      <select value={language} onChange={e=>setLanguage(e.target.value)} className={`${fieldClass} appearance-none`}>
                        <option value="es">Español</option>
                        <option value="en">English</option>
                        <option value="pt">Português</option>
                        <option value="fr">Français</option>
                      </select>
                    </label>
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs font-semibold text-zinc-300">Duración</span>
                      <select value={totalDuration} onChange={e=>setTotalDuration(Number(e.target.value))} className={`${fieldClass} appearance-none`}>
                        <option value={7}>7 segundos</option>
                        <option value={10}>10 segundos</option>
                        <option value={15}>15 segundos</option>
                      </select>
                    </label>
                    <button onClick={()=>processVideo()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 via-purple-600 to-pink-600 px-6 py-3.5 text-sm font-bold text-white shadow-[0_10px_30px_-10px_rgba(217,70,239,0.8)] transition hover:brightness-110 sm:w-auto">
                      <Sparkles className="h-4 w-4" /> Crear vídeo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-center py-14 text-center">
              <div className="relative h-24 w-24">
                <div className="absolute inset-0 rounded-full border-4 border-white/10" aria-hidden />
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-fuchsia-500 border-r-purple-500 motion-reduce:animate-none" aria-hidden />
                <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-white">{progress}%</div>
              </div>
              <p className="mt-6 text-sm font-semibold text-zinc-100">{status}</p>
              <p className="mt-1 text-xs text-zinc-500">Renderizando a 30 FPS · puede tardar unos segundos</p>
            </div>
          )}

          {step === 5 && finalVideo && (
            <div className="flex flex-col items-center pb-2 pt-2">
              <div className="relative">
                <div className="absolute -inset-5 rounded-[40px] bg-gradient-to-br from-fuchsia-500/30 via-purple-500/20 to-pink-500/30 blur-2xl" aria-hidden />
                <div className="relative h-[460px] w-[270px] overflow-hidden rounded-[30px] border border-white/15 bg-black p-2 shadow-2xl">
                  <div className="h-full w-full overflow-hidden rounded-[24px] bg-black">
                    <video src={finalVideo} controls autoPlay loop playsInline className="h-full w-full object-cover" />
                  </div>
                </div>
              </div>

              <div className="mt-8 w-full max-w-md space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={resetAll} className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] py-3 text-sm font-bold text-zinc-200 transition hover:border-white/30 hover:text-white">
                    <RefreshCcw className="h-4 w-4" /> Otro
                  </button>
                  <a href={finalVideo} download={`viral.${videoMimeType.includes("mp4")?"mp4":"webm"}`} className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 py-3 text-sm font-bold text-white shadow-[0_10px_30px_-10px_rgba(217,70,239,0.8)] transition hover:brightness-110">
                    <Download className="h-4 w-4" /> Guardar vídeo
                  </a>
                </div>
                <button onClick={async()=>{ try{ const r=await fetch(finalVideo); const b=await r.blob(); const f=new File([b],`viral.${videoMimeType.includes("mp4")?"mp4":"webm"}`,{type:b.type}); if((navigator as unknown as {canShare:(d:unknown)=>boolean}).canShare?.({files:[f]})) await (navigator as unknown as {share:(d:unknown)=>Promise<void>}).share({files:[f], title:"Viral"}); else window.open("https://www.tiktok.com/upload","_blank"); }catch{ window.open("https://www.tiktok.com/upload","_blank"); } }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#25f4ee]/25 bg-[#25f4ee]/5 py-3 text-sm font-bold text-[#7ff8f2] transition hover:border-[#25f4ee]/50 hover:bg-[#25f4ee]/10">
                  Abrir TikTok y publicar ↗
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {overlayOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/85 p-2 backdrop-blur-md sm:p-4">
          <div className="mx-auto flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950">
            <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900/80 px-4 py-3">
              <span className="text-xs font-bold text-zinc-200">TikTok — “{overlayQuery}” — elige los que te gusten</span>
              <button onClick={()=>setOverlayOpen(false)} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-zinc-200 transition hover:bg-white/20 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="relative min-h-0 flex-1 bg-white">
              <iframe src={`${API_BASE}/api/feed?q=${encodeURIComponent(overlayQuery)}`} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" title="TikTok"/>
              <div className="absolute bottom-3 left-3 right-3 flex gap-2 rounded-2xl border border-white/10 bg-black/90 p-3 backdrop-blur">
                <button onClick={async()=>{
                  // Listo: cierra el overlay, descarga los enlaces seleccionados y pasa a estilo
                  setOverlayOpen(false);
                  if (tiktokLinks.length>0) {
                    await handleDownload();
                  } else {
                    setTiktokError("Selecciona al menos 1 vídeo en el bot");
                  }
                }} className="flex-1 rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-600 py-2.5 text-xs font-bold text-white transition hover:brightness-110">
                  Listo — ver mis enlaces
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}