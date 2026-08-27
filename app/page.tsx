"use client";

import { useState, useRef, useEffect } from "react";
import { UploadCloud, Music, Mic, Wand2, Download, RefreshCcw, Globe, Link2, Loader2 } from "lucide-react";
import { VideoClip, AppMode } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues, generateViralMusic } from "@/lib/ttsEngine";
import { fetchTikTokClips } from "@/lib/tiktok";

export default function App() {
  const [step, setStep] = useState(1);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [mode, setMode] = useState<AppMode | null>(null);
  const [productPrompt, setProductPrompt] = useState("");
  const [language, setLanguage] = useState("es"); 
  const [totalDuration, setTotalDuration] = useState(10);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const [videoMimeType, setVideoMimeType] = useState<string>("video/webm");
  
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tiktokDraft, setTiktokDraft] = useState("");
  const [tiktokLinks, setTiktokLinks] = useState<string[]>([]);
  const [tiktokLoading, setTiktokLoading] = useState(false);
  const [tiktokError, setTiktokError] = useState("");

  // Asegurar limpieza estricta en desmontajes
  useEffect(() => {
    return () => {
      if (sharedAudioCtxRef.current) {
        sharedAudioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const clearMemory = () => {
    for (const c of clips) try { URL.revokeObjectURL(c.url); } catch {}
    if (finalVideo) try { URL.revokeObjectURL(finalVideo); } catch {}
  };

  const handleAddLink = () => {
    const raw = tiktokDraft.trim();
    if (!raw) return;
    const found = raw.match(/https?:\/\/[^\s]+/gi) || [];
    if (found.length === 0) {
      setTiktokError("Solo se aceptan enlaces de TikTok");
      return;
    }
    const valid = found.filter(u => /tiktok\.com|vm\.tiktok/i.test(u));
    if (valid.length === 0) {
      setTiktokError("Solo se aceptan enlaces de TikTok");
      return;
    }
    const dedup = valid.filter(u => !tiktokLinks.includes(u));
    if (dedup.length === 0) {
      setTiktokError("Ese enlace ya está añadido");
      return;
    }
    if (tiktokLinks.length + dedup.length > 5) {
      setTiktokError("Máximo 5 enlaces");
      return;
    }
    setTiktokLinks(prev => [...prev, ...dedup]);
    setTiktokDraft("");
    setTiktokError("");
  };

  const handleRemoveLink = (idx: number) => {
    setTiktokLinks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleTikTokDownload = async () => {
    if (tiktokLinks.length === 0) {
      setTiktokError("Añade al menos un enlace de TikTok");
      return;
    }
    const joined = tiktokLinks.join("\n");
    setTiktokError("");
    setTiktokLoading(true);
    setStatus("Descargando TikToks sin marca...");
    try {
      clearMemory();
      if (finalVideo) {
        try { URL.revokeObjectURL(finalVideo); } catch {}
        setFinalVideo(null);
      }
      const { clips: tkClips, errors } = await fetchTikTokClips(joined, (msg) => setStatus(msg));
      const accDur = tkClips.reduce((s, c) => s + c.playDuration, 0);
      setClips(tkClips);
      setTotalDuration(Math.min(15, Math.max(8, Math.round(accDur))));
      if (errors.length > 0) setTiktokError(`Descargados ${tkClips.length} OK. Errores: ${errors.join(" | ").slice(0, 200)}`);
      else setTiktokError("");
      setStep(2);
      setStatus("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTiktokError(msg);
    } finally {
      setTiktokLoading(false);
      setStatus("");
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    clearMemory();
    const fileArray = Array.from(files).filter(f => f.type.startsWith("video/"));
    if (fileArray.length === 0) {
      alert("Sube al menos un archivo de vídeo válido");
      return;
    }
    const validClips: VideoClip[] = [];
    let accDur = 0;
    for (const file of fileArray) {
      const url = URL.createObjectURL(file);
      const dur = await new Promise<number>((res) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        v.playsInline = true;
        v.src = url;
        let done = false;
        const finish = (d: number) => {
          if (done) return;
          done = true;
          v.removeAttribute("src");
          try { v.load(); } catch {}
          res(d);
        };
        v.onloadedmetadata = () => finish(Number.isFinite(v.duration) && v.duration > 0.5 ? v.duration : 3);
        v.onerror = () => finish(3);
        setTimeout(() => finish(3), 2500);
      });
      validClips.push({ file, url, startOffset: 0, playDuration: dur });
      accDur += dur;
    }
    if (validClips.length === 0) {
      alert("No se pudo leer ningún vídeo");
      return;
    }
    setClips(validClips.sort(() => Math.random() - 0.5));
    setTotalDuration(Math.min(15, Math.max(8, Math.round(accDur))));
    setStep(2);
  };

  const generateScriptLocal = (info: string, lang: string, targetDuration = 9) => {
    const rawInfo = info.replace(/https?:\/\/\S+/gi, "").trim() || "este producto";
    // Usar solo palabras clave, no la descripción exacta para no dejar rastro verbatim
    const words = rawInfo.split(/\s+/).filter(w => w.length > 2);
    const keyword = words.slice(0, 3).join(" ").slice(0, 22) || rawInfo.slice(0, 18);
    const cleanInfo = keyword;
    const lower = rawInfo.toLowerCase();
    const isCleaner = /limpia|deterg|mancha|suci|jab[oó]n|desinfect|multiusos|quitagrasa/.test(lower);
    const isVacuum = /aspira|polvo/.test(lower);
    const isCar = /coche|auto|veh[ií]culo|tapicer[ií]a|llanta/.test(lower);
    const isKitchen = /cocina|sart[eé]n|olla|freidora|horno|licuadora/.test(lower);
    const isBeauty = /crema|serum|maquill|piel|cabello|uñas/.test(lower);
    const isCloth = /ropa|camiseta|vestido|zapatilla|moda/.test(lower);

    const benefitPool: Record<string, string[]> = {
      cleaner: ["Elimina manchas y grasa en segundos sin frotar.", "Deja todo brillante y desinfectado al instante.", "Rinde muchísimo y no daña superficies."],
      vacuum: ["Aspira todo el polvo en una sola pasada.", "Llega a cada rincón sin esfuerzo.", "Silenciosa, potente y sin cables."],
      car: ["Deja tu coche como nuevo en minutos.", "Limpia tapicería y llantas sin esfuerzo.", "Brillo profesional sin ir al lavadero."],
      kitchen: ["Cocina más rápido y sin pegarse nada.", "Antiadherente y fácil de limpiar.", "Ahorra tiempo y energía cada día."],
      beauty: ["Notarás la diferencia desde el primer uso.", "Fórmula suave y efectiva.", "Piel y cabello radiantes al instante."],
      cloth: ["Cómoda, resistente y con estilo.", "Combina con todo y dura muchísimo.", "Talla perfecta y acabado premium."],
      generic: ["Te ahorra horas de esfuerzo y es súper fácil.", "La calidad te dejará con la boca abierta.", "Es el mejor invento y funciona perfecto."],
    };
    let benefits = benefitPool.generic;
    if (isCleaner) benefits = benefitPool.cleaner;
    else if (isVacuum) benefits = benefitPool.vacuum;
    else if (isCar) benefits = benefitPool.car;
    else if (isKitchen) benefits = benefitPool.kitchen;
    else if (isBeauty) benefits = benefitPool.beauty;
    else if (isCloth) benefits = benefitPool.cloth;

    const data: Record<string, { hooks: string[], benefits: string[], calls: string[] }> = {
      es: {
        hooks: [`¿Cansado de los mismos problemas? Necesitas ${cleanInfo}.`, `El secreto que nadie te quiere contar sobre ${cleanInfo}.`, `Mira cómo ${cleanInfo} me salvó la vida.`],
        benefits,
        calls: ["Consíguelo hoy y cambia tu rutina.", "Pruébalo ahora. Te encantará.", "Empieza a usarlo ya. No te arrepentirás."]
      },
      en: {
        hooks: [`Tired of the same problems? You need ${cleanInfo}.`, `The secret nobody tells you about ${cleanInfo}.`, `Look how ${cleanInfo} totally saved my day.`],
        benefits: ["It saves you hours of effort and is super easy.", "The quality will blow your mind.", "It's the best invention of the year."],
        calls: ["Get it today and change your routine.", "Try it now, you won't regret it.", "Start using it."]
      },
      pt: {
        hooks: [`Cansado dos mesmos problemas? Você precisa de ${cleanInfo}.`, `O segredo que ninguém te conta sobre ${cleanInfo}.`, `Olha como ${cleanInfo} salvou meu dia.`],
        benefits: ["Economiza horas de esforço e é super fácil.", "A qualidade vai te deixar de queixo caído.", "É a melhor invenção do ano."],
        calls: ["Garanta o seu hoje.", "Experimente agora, você não vai se arrepender.", "Comece a usar."]
      },
      fr: {
        hooks: [`Fatigué des mêmes problèmes? Vous avez besoin de ${cleanInfo}.`, `Le secret que personne ne vous dit sur ${cleanInfo}.`, `Regardez comment ${cleanInfo} a sauvé ma journée.`],
        benefits: ["Cela vous fait gagner des heures d'efforts.", "La qualité vous époustouflera.", "C'est la meilleure invention de l'année."],
        calls: ["Obtenez-le aujourd'hui.", "Essayez-le maintenant.", "Commencez à l'utiliser."]
      }
    };

    const d = data[lang] || data["es"];
    const h = d.hooks[Math.floor(Math.random() * d.hooks.length)];
    const b = d.benefits[Math.floor(Math.random() * d.benefits.length)];
    const c = d.calls[Math.floor(Math.random() * d.calls.length)];
    let full = `${h} ${b} ${c}`;
    // Adaptar longitud al vídeo: 6s = corto (~110 chars), 8-9s = medio (~150), 10s+ = largo
    const maxChars = targetDuration <= 6 ? 110 : targetDuration <= 8 ? 150 : targetDuration <= 10 ? 190 : 240;
    if (full.length > maxChars) {
      // Recortar sin cortar palabra y sin dejar frase a medias
      let cut = full.slice(0, maxChars);
      const lastDot = cut.lastIndexOf(".");
      const lastSpace = cut.lastIndexOf(" ");
      if (lastDot > maxChars * 0.6) cut = cut.slice(0, lastDot + 1);
      else if (lastSpace > 0) cut = cut.slice(0, lastSpace).trim() + ".";
      full = cut;
    }
    return full;
  };

  const processVideo = async () => {
    setStep(4);
    setProgress(5);
    setStatus("Activando canales de audio (safari-safe)...");

    try {
      // 1. INICIALIZACIÓN INMEDIATA DEL CONTEXTO (Bypass Safari Audio Lock)
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext no soportado");
      const ctx = new AudioContextClass();
      await ctx.resume();
      sharedAudioCtxRef.current = ctx;

      let audioBuffer: AudioBuffer | null = null;
      let wordChunks: string[] = [];
      let isFallback = false;

      setProgress(15);

      if (mode === "voice") {
        setStatus(`Generando guion y voz en ${language.toUpperCase()}...`);
        const script = generateScriptLocal(productPrompt, language, totalDuration);
        
        // Pasamos el callback de Status para evitar congelamiento visual en pantalla
        const tts = await generateSpeechAndCues(script, language, ctx, (msg) => setStatus(msg));
        audioBuffer = tts.audioBuffer;
        wordChunks = tts.wordChunks;
        isFallback = tts.isFallback;
        if (isFallback) setStatus("Voz local activada (sin pitido)...");
      } else {
        setStatus("Generando base musical...");
        audioBuffer = await generateViralMusic(totalDuration);
      }

      setProgress(30);
      setStatus("Renderizando vídeo final a 30 FPS...");
      
      const { url, mimeType } = await renderFinalVideo({
        clips, 
        audioBuffer, 
        audioContext: ctx,
        wordChunks, 
        mode: mode!, 
        targetDuration: totalDuration, 
        onProgress: (p) => setProgress(30 + Math.round(p * 0.7)), // Escala el 70% restante
        isFallback,
      });

      setVideoMimeType(mimeType);
      setFinalVideo(url);
      setStep(5);
    } catch (e: unknown) {
      console.error("[Proceso interrumpido]", e);
      if (sharedAudioCtxRef.current) {
        sharedAudioCtxRef.current.close().catch(() => {});
        sharedAudioCtxRef.current = null;
      }
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Ocurrió un error en el procesado: \n${msg}`);
      setStep(3); 
    }
  };

  const resetAll = () => {
    clearMemory();
    setClips([]);
    setFinalVideo(null);
    setProductPrompt("");
    setTiktokDraft("");
    setTiktokLinks([]);
    setTiktokError("");
    setMode(null);
    setLanguage("es");
    setTotalDuration(10);
    setProgress(0);
    setStatus("");
    setVideoMimeType("video/webm");
    if (sharedAudioCtxRef.current) {
      sharedAudioCtxRef.current.close().catch(() => {});
      sharedAudioCtxRef.current = null;
    }
    setStep(1);
  };

  const fileExtension = videoMimeType.includes("mp4") ? "mp4" : "webm";

  return (
    <main className="min-h-[100dvh] bg-[#09090b] text-white flex flex-col items-center justify-center p-4 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-xl text-center mb-6 sm:mb-8 mt-4">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold mb-3 sm:mb-4 tracking-widest">
          CREADOR VIRAL V3 FINAL
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent leading-tight">
          Creador Viral
        </h1>
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 shadow-2xl relative overflow-hidden">
        
        {step === 1 && (
          <div className="space-y-5">
            {/* TikTok minimalista - idéntico a subir vídeos */}
            <div className="border-2 border-dashed border-zinc-700 hover:border-zinc-600 bg-zinc-950/50 rounded-3xl p-6 sm:p-7 flex flex-col items-center text-center space-y-3 transition-colors">
              <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center">
                <Link2 className="w-7 h-7 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-bold text-base">Pega tu enlace de TikTok</h3>
                <p className="text-xs text-zinc-500 mt-1">Se creará un video viral sin marca</p>
              </div>
              {tiktokLinks.length > 0 && (
                <span className="text-xs font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 px-3 py-1 rounded-full">
                  {tiktokLinks.length} {tiktokLinks.length === 1 ? "vídeo listo" : "vídeos listos"}
                </span>
              )}
              <div className="w-full flex gap-2">
                <input
                  value={tiktokDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTiktokDraft(v);
                    // Auto-añadir al pegar enlace completo
                    if (/https?:\/\/.*tiktok\.com/i.test(v) || /https?:\/\/vm\.tiktok/i.test(v)) {
                      const hasSpace = /\s/.test(v);
                      const looksComplete = v.trim().length > 25 && (hasSpace || v.includes("video") || v.includes("vm.tiktok"));
                      if (looksComplete) {
                        setTimeout(() => {
                          const found = v.match(/https?:\/\/[^\s,]+/gi);
                          if (found && found.some(u => /tiktok/i.test(u))) {
                            // Simular añadir sin esperar Enter
                            const candidates = found.filter(u => /tiktok/i.test(u));
                            const dedup = candidates.filter(u => !tiktokLinks.includes(u));
                            if (dedup.length > 0 && tiktokLinks.length + dedup.length <= 5) {
                              setTiktokLinks(prev => [...prev, ...dedup]);
                              setTiktokDraft("");
                              setTiktokError("");
                            }
                          }
                        }, 400);
                      }
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddLink(); } }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    const isTikTok = /tiktok\.com|vm\.tiktok/i.test(text);
                    if (!isTikTok) {
                      e.preventDefault();
                      setTiktokError("Solo se aceptan enlaces de TikTok");
                      return;
                    }
                    e.preventDefault();
                    const found = text.match(/https?:\/\/[^\s,]+/gi) || [];
                    const valid = found.filter(u => /tiktok/i.test(u));
                    if (valid.length === 0) {
                      setTiktokError("Solo se aceptan enlaces de TikTok");
                      return;
                    }
                    const dedup = valid.filter(u => !tiktokLinks.includes(u));
                    if (dedup.length === 0) {
                      setTiktokError("Ese enlace ya está añadido");
                      return;
                    }
                    if (dedup.length > 0 && tiktokLinks.length + dedup.length <= 5) {
                      setTiktokLinks(prev => [...prev, ...dedup]);
                      setTiktokDraft("");
                      setTiktokError("");
                    }
                  }}
                  placeholder="pega aqui tu enlace de tiktok"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-sm focus:border-zinc-600 outline-none text-center sm:text-left"
                />
                <button
                  onClick={handleAddLink}
                  disabled={!tiktokDraft.trim() || tiktokLinks.length >= 5}
                  className="px-6 py-3 bg-white text-black rounded-full font-bold text-sm hover:bg-zinc-100 disabled:opacity-40 active:scale-95 transition whitespace-nowrap"
                >
                  Añadir
                </button>
              </div>
              {tiktokLinks.length > 0 && (
                <div className="w-full space-y-2 max-h-[140px] overflow-y-auto">
                  {tiktokLinks.map((link, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2 text-xs">
                      <span className="w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">{idx + 1}</span>
                      <span className="flex-1 truncate text-zinc-300 text-left">{link}</span>
                      <button
                        onClick={() => handleRemoveLink(idx)}
                        className="w-7 h-7 bg-zinc-800 hover:bg-zinc-700 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition shrink-0"
                        aria-label="Quitar"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {tiktokError && (
                <div className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 whitespace-pre-wrap">{tiktokError}</div>
              )}
              {status && tiktokLoading && (
                <div className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />{status}</div>
              )}
              {tiktokLinks.length > 0 && (
                <button
                  onClick={handleTikTokDownload}
                  disabled={tiktokLoading}
                  className="w-full py-3 bg-white text-black rounded-full font-bold text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 disabled:opacity-50 active:scale-[0.98] transition"
                >
                  {tiktokLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</> : <>Crear video viral ({tiktokLinks.length})</>}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-xs text-zinc-500 px-2">o</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>

            <div onClick={() => fileInput.current?.click()} className="border-2 border-dashed border-zinc-700 hover:border-purple-500 bg-zinc-950/50 rounded-2xl sm:rounded-3xl p-8 sm:p-12 flex flex-col items-center cursor-pointer transition-all active:scale-95 touch-manipulation">
              <input type="file" ref={fileInput} onChange={(e) => handleUpload(e.target.files)} multiple accept="video/*" className="hidden" />
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-4 transition-transform">
                <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10 text-purple-400" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-center">Toca para subir vídeos</h2>
              <p className="text-xs text-zinc-500 mt-1">Desde tu galería (mismo flujo Voz/Música)</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg sm:text-xl font-bold mb-4">¿Qué formato quieres crear?</h2>
            <button onClick={() => { setMode("music"); setStep(3); }} className="w-full p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-blue-500 active:bg-blue-900/20 transition-all touch-manipulation">
              <div className="p-3 sm:p-4 bg-blue-500/10 rounded-full shrink-0"><Music className="text-blue-400 w-6 h-6" /></div>
              <div className="text-left">
                <h3 className="font-bold text-base sm:text-lg">Modo Musical</h3>
                <p className="text-zinc-500 text-xs sm:text-sm line-clamp-2">Cortes rápidos + Beat autogenerado.</p>
              </div>
            </button>
            <button onClick={() => { setMode("voice"); setStep(3); }} className="w-full p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-purple-500 active:bg-purple-900/20 transition-all touch-manipulation">
              <div className="p-3 sm:p-4 bg-purple-500/10 rounded-full shrink-0"><Mic className="text-purple-400 w-6 h-6" /></div>
              <div className="text-left">
                <h3 className="font-bold text-base sm:text-lg">Modo Narrador IA</h3>
                <p className="text-zinc-500 text-xs sm:text-sm line-clamp-2">Guion, voz humana rápida y subtítulos.</p>
              </div>
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {mode === "voice" && (
              <>
                <div className="flex items-center justify-between">
                  <label className="font-bold text-base sm:text-lg">Describe el producto</label>
                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1">
                    <Globe className="w-4 h-4 text-zinc-400" />
                    <select 
                      value={language} 
                      onChange={(e) => setLanguage(e.target.value)}
                      className="bg-transparent text-xs sm:text-sm outline-none cursor-pointer"
                    >
                      <option value="es">Español</option>
                      <option value="en">English</option>
                      <option value="pt">Português</option>
                      <option value="fr">Français</option>
                    </select>
                  </div>
                </div>
                <textarea 
                  value={productPrompt} onChange={(e) => setProductPrompt(e.target.value)}
                  placeholder="Ej: Aspiradora portátil para coche..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 sm:p-4 focus:border-purple-500 outline-none h-28 sm:h-32 resize-none text-sm sm:text-base"
                />
              </>
            )}
            <button onClick={processVideo} disabled={mode === "voice" && productPrompt.length < 5} className="w-full py-3 sm:py-4 bg-white text-black rounded-xl font-bold text-base sm:text-lg flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 touch-manipulation transition-transform">
              <Wand2 className="w-5 h-5" /> Crear Vídeo
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="py-8 sm:py-12 flex flex-col items-center">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 mb-6">
              <div className="absolute inset-0 border-4 border-zinc-800 border-t-purple-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center font-bold font-mono text-sm sm:text-base">{progress}%</div>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-center">Procesando...</h2>
            <p className="text-zinc-500 text-xs sm:text-sm mt-2 text-center px-4">{status}</p>
          </div>
        )}

        {step === 5 && finalVideo && (
          <div className="flex flex-col items-center animate-in zoom-in duration-500">
            <div className="w-[240px] h-[426px] sm:w-[280px] sm:h-[498px] bg-black rounded-2xl sm:rounded-[2rem] overflow-hidden border-2 sm:border-4 border-zinc-800 shadow-2xl relative mb-6 sm:mb-8">
              <video src={finalVideo} controls autoPlay loop playsInline className="w-full h-full object-cover" />
            </div>
            <div className="flex w-full gap-3 sm:gap-4">
              <button onClick={resetAll} className="flex-1 py-3 sm:py-4 bg-zinc-800 rounded-xl font-bold flex items-center justify-center gap-2 active:bg-zinc-700 text-sm sm:text-base touch-manipulation">
                <RefreshCcw className="w-4 h-4 sm:w-5 sm:h-5" /> Otro
              </button>
              <a href={finalVideo} download={`tiktok-viral-${language}.${fileExtension}`} className="flex-1 py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2 text-sm sm:text-base touch-manipulation">
                <Download className="w-4 h-4 sm:w-5 sm:h-5" /> Guardar
              </a>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
