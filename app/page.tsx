"use client";

import { useState, useRef, useEffect } from "react";
import { UploadCloud, Music, Mic, Wand2, Download, RefreshCcw, Globe, Link2, Loader2 } from "lucide-react";
import { VideoClip, AppMode } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues, generateViralMusic } from "@/lib/ttsEngine";
import { fetchTikTokClips } from "@/lib/tiktok";
import { searchTikTokClean, TikTokSearchResult } from "@/lib/tiktokSearch";
import { analyzeProductFromImage, verifyCoverMatchesProduct } from "@/lib/imageAnalyze";

const API_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "/videos";

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
  const [autoProduct, setAutoProduct] = useState("");
  const [autoResults, setAutoResults] = useState<(TikTokSearchResult & { selected: boolean })[]>([]);
  const [autoSearching, setAutoSearching] = useState(false);
  const [autoError, setAutoError] = useState("");
  const [autoPhoto, setAutoPhoto] = useState<File | null>(null);
  const [autoPhotoPreview, setAutoPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [tiktokUser, setTiktokUser] = useState<{ display_name: string; avatar_url: string; open_id: string } | null>(null);
  const [tiktokChecking, setTiktokChecking] = useState(true);
  const [tiktokPublishing, setTiktokPublishing] = useState(false);
  const [tiktokPublishMsg, setTiktokPublishMsg] = useState("");
  const [autoUpload, setAutoUpload] = useState(false);
  const [tiktokOverlayOpen, setTiktokOverlayOpen] = useState(false);
  const [tiktokOverlayQuery, setTiktokOverlayQuery] = useState("");

  // Asegurar limpieza estricta en desmontajes
  useEffect(() => {
    return () => {
      if (sharedAudioCtxRef.current) {
        sharedAudioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // TikTok: comprobar conexión y manejar callback ?tiktok=connected
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktok") === "connected") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTiktokPublishMsg("¡TikTok conectado!");
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setTiktokPublishMsg(""), 4000);
    }
    if (params.get("tiktok_error")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTiktokError(decodeURIComponent(params.get("tiktok_error")!));
      window.history.replaceState({}, "", window.location.pathname);
    }
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tiktok/status`, { cache: "no-store" });
        const j = await res.json();
        if (j.connected) {
          setTiktokConnected(true);
          setTiktokUser({ display_name: j.display_name || "", avatar_url: j.avatar_url || "", open_id: j.open_id || "" });
        } else {
          setTiktokConnected(false);
          setTiktokUser(null);
          // TikTok 100% opcional: sin tokens ni verificación, todo sigue funcionando en modo manual
          if (j.reason === "not_configured") {
            console.log("TikTok directo opcional no configurado, modo manual activo");
          }
        }
      } catch {
        setTiktokConnected(false);
      } finally {
        setTiktokChecking(false);
      }
    };
    check();
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

  const handleAutoSearch = async () => {
    const kw = autoProduct.trim() || productPrompt.trim();
    if (!kw || kw.length < 2) { setAutoError("Escribe el nombre del producto"); return; }
    // Automático por encima: abrir TikTok en overlay pequeño, sin redirigir
    setTiktokOverlayQuery(kw);
    setTiktokOverlayOpen(true);
    // También lanzar búsqueda interna en paralelo
    await handleAutoSearchWithKeyword(kw);
  };

  const toggleAutoSelect = (idx: number) => {
    setAutoResults(prev => prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  };

  const openTikTokOverlay = (kw: string) => {
    setTiktokOverlayQuery(kw);
    setTiktokOverlayOpen(true);
  };
  // Bot que escucha enlaces de Compartir del iframe y los descarga solo
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type === "TIKTOK_LINKS" && Array.isArray(e.data.links) && e.data.links.length > 0) {
        const links: string[] = e.data.links.slice(0,5);
        setTiktokLinks(prev => {
          const s = new Set(prev);
          const add = links.filter(u => !s.has(u));
          return [...prev, ...add].slice(0,5);
        });
        // Auto-descargar sin marca en cuanto llegan
        setTimeout(async () => {
          try {
            const joined = links.join("\n");
            const { clips: tkClips } = await fetchTikTokClips(joined, (m)=>setStatus(m));
            const accDur = tkClips.reduce((s,c)=>s+c.playDuration,0);
            setClips(tkClips);
            setTotalDuration(Math.min(15, Math.max(8, Math.round(accDur))));
            setTiktokOverlayOpen(false);
            setStep(2);
            setStatus("");
          } catch {}
        }, 500);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  const handlePhotoSelect = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) { setAutoError("Sube una foto válida (jpg, png)"); return; }
    if (autoPhotoPreview) try { URL.revokeObjectURL(autoPhotoPreview); } catch {}
    const url = URL.createObjectURL(file);
    setAutoPhoto(file);
    setAutoPhotoPreview(url);
    setAutoError("");
    setStatus("Analizando foto para identificar el producto exacto...");
    let product = "";
    try {
      product = await analyzeProductFromImage(file, (m) => setStatus(m));
    } catch {}
    const isGeneric = !product || ["web site","website","producto"].includes(product.toLowerCase()) || product.length < 3;
    if (isGeneric) {
      // Usar el nombre del archivo si es descriptivo, si no pedir manual
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 30);
      if (name && name.length > 2 && !/^(image|photo|img)_\d+$/i.test(name)) {
        product = name;
      } else {
        setAutoError("No identifiqué el producto. Escribe su nombre (ej: tijeras con laser) y pulsa Buscar.");
        setStatus("");
        return;
      }
    }
    // Guardar producto y abrir overlay TikTok automático por encima + buscar
    setAutoProduct(product);
    setProductPrompt(product);
    setTiktokOverlayQuery(product);
    setTiktokOverlayOpen(true);
    await handleAutoSearchWithKeyword(product);
  };

  const createVideoFromImage = async (imageFile: File, durationSec = 7): Promise<VideoClip> => {
    const imgUrl = URL.createObjectURL(imageFile);
    const canvas = document.createElement("canvas");
    canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas no soportado");
    const img = new Image();
    img.src = imgUrl;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("No se pudo leer imagen"));
      setTimeout(() => rej(new Error("Timeout imagen")), 4000);
    });
    // Dibujar con cover
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    URL.revokeObjectURL(imgUrl);
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const videoUrl = await new Promise<string>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const file = new File([blob], `foto-${Date.now()}.webm`, { type: "video/webm" });
        // Validar duración
        const v = document.createElement("video");
        v.preload = "metadata"; v.src = url;
        v.onloadedmetadata = () => {
          const d = v.duration || durationSec;
          resolve(url);
          // No revocar aún, lo usará el clip
        };
        v.onerror = () => resolve(url);
        setTimeout(() => resolve(url), 1000);
      };
      recorder.onerror = () => reject(new Error("No se pudo crear vídeo de la foto"));
      recorder.start();
      // Grabar 7s con ligero zoom
      let start = performance.now();
      const draw = () => {
        if (performance.now() - start >= durationSec * 1000) { recorder.stop(); stream.getTracks().forEach(t => t.stop()); return; }
        // Ligero ken burns
        const p = (performance.now() - start) / (durationSec * 1000);
        const s = 1 + p * 0.08;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, (canvas.width - w * s) / 2, (canvas.height - h * s) / 2, w * s, h * s);
        requestAnimationFrame(draw);
      };
      draw();
      setTimeout(() => { try { if (recorder.state === "recording") recorder.stop(); } catch {} }, durationSec * 1000 + 500);
    });
    // Crear File y VideoClip
    const resBlob = await fetch(videoUrl).then(r => r.blob());
    const file = new File([resBlob], `foto-${Date.now()}.webm`, { type: "video/webm" });
    return { file, url: videoUrl, startOffset: 0, playDuration: durationSec };
  };

  const handleAutoSearchWithKeyword = async (kw: string) => {
    const clean = kw.trim();
    if (!clean || clean.length < 2) return;
    if (clean.toLowerCase() === "web site" || clean.toLowerCase() === "website") {
      setAutoError("No se pudo detectar el producto en la foto. Escribe el nombre manualmente (ej: tijeras con laser) y pulsa Buscar.");
      return;
    }
    setAutoError(""); setAutoSearching(true); setStatus(`Buscando vídeos reales de "${clean}" en TikTok...`);
    try {
      const results = await searchTikTokClean(clean, 10, (m) => setStatus(m));
      const final = results.slice(0, 8);
      // Mostrar siempre los vídeos encontrados en la galería de abajo
      setAutoResults(final.map((r, i) => ({ ...r, selected: i < 3 })));
      if (final.length === 0) setAutoError(`No se encontraron vídeos de "${clean}" en TikTok. Intenta otro nombre.`);
      setStatus("");
    } catch (e) {
      setAutoResults([]);
      setAutoError(e instanceof Error ? e.message : `No se pudo buscar "${clean}". Revisa el nombre e inténtalo de nuevo.`);
      setStatus("");
    } finally { setAutoSearching(false); setStatus(""); }
  };

  const handleAutoUse = async () => {
    const selected = autoResults.filter(r => r.selected);
    if (selected.length === 0) { setAutoError("Selecciona al menos 1 vídeo"); return; }
    setTiktokLoading(true); setStatus(`Descargando ${selected.length} vídeos sin marca...`);
    try {
      clearMemory();
      if (finalVideo) { try { URL.revokeObjectURL(finalVideo); } catch {} setFinalVideo(null); }
      // Reusa fetchTikTokClips pero con play URLs directas: construimos pseudo-urls
      // Descargamos directo aquí para no pasar por tikwm api de nuevo
      const clips: VideoClip[] = [];
      for (let i = 0; i < selected.length; i++) {
        const play = selected[i].play;
        setStatus(`Bajando vídeo ${i + 1}/${selected.length}...`);
        const blob = await (async () => {
          try {
            const r = await fetch(play, { cache: "no-store" });
            if (r.ok) { const b = await r.blob(); if (b.size > 10000) return b; }
          } catch {}
          // Refrescar URL si expiró (tikwm lookup con webUrl)
          try {
            const web = (selected[i] as { webUrl?: string }).webUrl || `https://www.tiktok.com/@${selected[i].author}/video/${selected[i].id}`;
            const freshRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(web)}`, { cache: "no-store" });
            if (freshRes.ok) {
              const j = await freshRes.json();
              const fresh = j?.data?.play || j?.data?.hdplay;
              if (fresh) {
                const r3 = await fetch(fresh, { cache: "no-store" });
                if (r3.ok) { const b3 = await r3.blob(); if (b3.size > 10000) return b3; }
              }
            }
          } catch {}
          const prox = `https://corsproxy.io/?${encodeURIComponent(play)}`;
          const r2 = await fetch(prox, { cache: "no-store" });
          if (!r2.ok) throw new Error("descarga falló");
          const b2 = await r2.blob();
          if (b2.size < 10000) throw new Error("vídeo vacío");
          return b2;
        })();
        const url = URL.createObjectURL(blob);
        const dur = await new Promise<number>((res) => {
          const v = document.createElement("video");
          v.preload = "metadata"; v.muted = true; v.playsInline = true; v.src = url;
          let done = false; const finish = (d: number) => { if (done) return; done = true; v.removeAttribute("src"); try { v.load(); } catch {} v.remove(); res(d); };
          v.onloadedmetadata = () => finish(Number.isFinite(v.duration) && v.duration > 0.5 ? v.duration : 4);
          v.onerror = () => finish(4); setTimeout(() => finish(4), 2500);
        });
        const file = new File([blob], `tiktok-auto-${Date.now()}-${i}.mp4`, { type: blob.type || "video/mp4" });
        clips.push({ file, url, startOffset: 0, playDuration: dur });
      }
      const accDur = clips.reduce((s, c) => s + c.playDuration, 0);
      setClips(clips);
      setTotalDuration(Math.min(15, Math.max(8, Math.round(accDur))));
      // Si no hay descripción, usar el producto buscado
      if (!productPrompt.trim()) setProductPrompt(autoProduct.trim());
      setStep(2);
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : String(e));
    } finally { setTiktokLoading(false); setStatus(""); }
  };

  const handleShareTikTok = async () => {
    if (!finalVideo) return;
    try {
      const res = await fetch(finalVideo);
      const blob = await res.blob();
      const file = new File([blob], `viral-${Date.now()}.${videoMimeType.includes("mp4") ? "mp4" : "webm"}`, { type: blob.type });
      const nav = navigator as unknown as { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: "Video viral", text: productPrompt.slice(0, 100) });
        return;
      }
    } catch {}
    window.open("https://www.tiktok.com/upload", "_blank");
  };

  const handleTikTokConnect = async () => {
    // Si TikTok no está configurado en Vercel, no ir a /auth (daría 500), hacer share manual directo
    try {
      const r = await fetch(`${API_BASE}/api/tiktok/status`, { cache: "no-store" });
      const j = await r.json();
      if (j.reason === "not_configured") {
        setTiktokPublishMsg("TikTok directo no configurado en este deployment — usando modo manual. Puedes crear y subir vídeos igual con “Compartir manual”.");
        setTimeout(() => handleShareTikTok(), 800);
        return;
      }
    } catch {}
    window.location.assign(`${API_BASE}/api/tiktok/auth`);
  };

  const handleTikTokLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/tiktok/logout`, { method: "POST", cache: "no-store" });
    } catch {}
    setTiktokConnected(false);
    setTiktokUser(null);
  };

  const handleTikTokPublish = async (mode: "publish" | "draft") => {
    if (!finalVideo) return;
    if (!tiktokConnected) {
      handleTikTokConnect();
      return;
    }
    setTiktokPublishing(true);
    setTiktokPublishMsg("");
    try {
      const res = await fetch(finalVideo);
      const blob = await res.blob();
      const ext = videoMimeType.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `viral-${Date.now()}.${ext}`, { type: blob.type || `video/${ext}` });
      const form = new FormData();
      form.append("video", file);
      form.append("title", productPrompt.slice(0, 150) || "Video viral con Creador Viral #fyp");
      form.append("mode", mode);
      form.append("privacy_level", "SELF_ONLY");
      const apiRes = await fetch(`${API_BASE}/api/tiktok/publish`, { method: "POST", body: form });
      const j = await apiRes.json();
      if (!apiRes.ok) throw new Error(j.error || "Error al publicar");
      setTiktokPublishMsg(j.message || (mode === "publish" ? "¡Publicado en TikTok!" : "¡Guardado como borrador en TikTok!"));
      // No simular: solo mostramos lo que realmente devolvió TikTok
    } catch (e) {
      setTiktokPublishMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTiktokPublishing(false);
    }
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
    setAutoProduct("");
    setAutoResults([]);
    setAutoError("");
    if (autoPhotoPreview) try { URL.revokeObjectURL(autoPhotoPreview); } catch {}
    setAutoPhoto(null);
    setAutoPhotoPreview(null);
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

  // Auto-subir a TikTok si está activado y el vídeo ya está listo
  useEffect(() => {
    if (autoUpload && finalVideo && step === 5) {
      const t = setTimeout(() => {
        if (tiktokConnected) handleTikTokPublish("publish");
        else handleShareTikTok();
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [finalVideo, autoUpload, step, tiktokConnected]);

  const fileExtension = videoMimeType.includes("mp4") ? "mp4" : "webm";

  return (
    <main className="flex-1 bg-[#09090b] text-white flex flex-col items-center justify-center p-4 sm:p-6 overflow-x-hidden py-8 sm:py-12">
      <div className="w-full max-w-xl text-center mb-6 sm:mb-8 mt-4">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold mb-3 sm:mb-4 tracking-widest">
          CREADOR VIRAL V3 FINAL
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent leading-tight">
          Creador Viral
        </h1>
      </div>

      {/* TikTok Login Kit - Conectar */}
      <div className="w-full max-w-xl mb-4">
        {tiktokChecking ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Comprobando TikTok...
          </div>
        ) : tiktokConnected && tiktokUser ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3">
            {tiktokUser.avatar_url ? (
              <img src={tiktokUser.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-zinc-700" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white font-bold text-sm">
                {(tiktokUser.display_name || "T").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1 text-left">
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> {tiktokUser.display_name || tiktokUser.open_id}
              </div>
              <div className="text-xs text-zinc-500">TikTok conectado</div>
            </div>
            <button
              onClick={handleTikTokLogout}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-xs font-bold transition"
            >
              Desconectar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={handleTikTokConnect}
              className="w-full bg-black border border-zinc-800 hover:border-zinc-700 rounded-2xl px-4 py-3 flex items-center justify-center gap-3 transition"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.8.11V8.94a6.27 6.27 0 00-.8-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.2 8.2 0 004.77 1.52V6.84a4.83 4.83 0 01-1.01-.15z" /></svg>
              <span className="text-sm font-bold">Conectar TikTok</span>
              <span className="text-xs text-zinc-500 hidden sm:inline">— opcional</span>
            </button>
            <p className="text-[11px] text-zinc-500 text-center">Opcional. Sin conectar puedes crear, descargar y subir manual a TikTok igual.</p>
          </div>
        )}
        {tiktokPublishMsg && (
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-center text-zinc-300">{tiktokPublishMsg}</div>
        )}
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 shadow-2xl relative overflow-hidden">
        
        {step === 1 && (
          <div className="space-y-5">
            {/* Automático por producto - minimalista igual que resto */}
            <div className="border-2 border-dashed border-zinc-700 hover:border-zinc-600 bg-zinc-950/50 rounded-3xl p-6 sm:p-7 flex flex-col items-center text-center space-y-3 transition-colors">
              <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center">
                <Wand2 className="w-7 h-7 text-purple-400" />
              </div>
              <div>
                <h3 className="font-bold text-base">Modo Automático</h3>
                <p className="text-xs text-zinc-500 mt-1">Escribe el producto y buscamos vídeos limpios sin marca</p>
              </div>
              <div className="w-full flex gap-2">
                <input
                  value={autoProduct}
                  onChange={(e) => setAutoProduct(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAutoSearch(); } }}
                  placeholder="ej: limpiador manchas coche"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-sm focus:border-zinc-600 outline-none text-center sm:text-left"
                />
                <button
                  onClick={handleAutoSearch}
                  disabled={autoSearching || (!autoProduct.trim() && !autoPhoto)}
                  className="px-6 py-3 bg-white text-black rounded-full font-bold text-sm hover:bg-zinc-100 disabled:opacity-40 active:scale-95 transition whitespace-nowrap"
                >
                  {autoSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
                </button>
              </div>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoSelect(e.target.files)} />
              <button
                onClick={() => photoInputRef.current?.click()}
                className="w-full py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-full text-xs font-medium flex items-center justify-center gap-2 transition"
              >
                <UploadCloud className="w-4 h-4 text-zinc-400" /> {autoPhoto ? "Cambiar foto" : "Subir foto del producto (opcional)"}
              </button>
              {autoPhotoPreview && (
                <div className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-2">
                  <img src={autoPhotoPreview} alt="preview" className="w-14 h-14 rounded-xl object-cover border border-zinc-700" />
                  <div className="flex-1 text-left">
                    <div className="text-xs font-medium truncate">{autoPhoto?.name}</div>
                    <div className="text-[11px] text-zinc-500">Se usará para buscar vídeos de este artículo</div>
                  </div>
                  <button onClick={() => { if (autoPhotoPreview) try { URL.revokeObjectURL(autoPhotoPreview); } catch {}; setAutoPhoto(null); setAutoPhotoPreview(null); }} className="w-7 h-7 bg-zinc-800 hover:bg-zinc-700 rounded-full flex items-center justify-center text-zinc-400 transition">✕</button>
                </div>
              )}
              {autoError && <div className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 whitespace-pre-wrap">{autoError}</div>}
              {status && autoSearching && <div className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />{status}</div>}
              {/* Abrir TikTok real por encima - lupa del producto exacto */}
              {(autoProduct.trim() || autoPhoto) && (
                <div className="w-full bg-black border border-zinc-800 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold flex items-center gap-2"><span className="text-base">🔍</span> ¿Quieres vídeos reales de TikTok?</div>
                  <p className="text-[11px] text-zinc-500">Abrimos TikTok con tu producto, tú copias los enlaces y aquí los bajas sin marca al instante.</p>
                  <button
                    onClick={() => openTikTokOverlay((autoProduct.trim() || "producto").trim())}
                    className="w-full py-2.5 bg-[#fe2c55] hover:bg-[#e0264d] rounded-full text-white text-xs font-bold flex items-center justify-center gap-2 transition"
                  >
                    Abrir TikTok — buscar &quot;{(autoProduct.trim() || "tu producto")}&quot; ↗
                  </button>
                  <div className="flex gap-2">
                    <input
                      id="tiktok-paste"
                      placeholder="Pega aquí 1-3 enlaces de TikTok copiados (uno por línea)"
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2 text-xs focus:border-zinc-600 outline-none"
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (!v) return;
                          const ta = document.getElementById("tiktok-paste-links") as HTMLTextAreaElement | null;
                          if (ta) { ta.value = v; ta.dispatchEvent(new Event("change", { bubbles: true })); }
                        }
                      }}
                    />
                  </div>
                  <textarea
                    id="tiktok-paste-links"
                    rows={2}
                    placeholder="https://www.tiktok.com/@user/video/123...&#10;https://www.tiktok.com/@user/video/456..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-2 text-xs focus:border-zinc-600 outline-none resize-none"
                    onChange={(e) => {
                      const raw = e.target.value;
                      const urls = raw.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
                      const dedup: string[] = []; const seen = new Set<string>();
                      for (const u of urls) { const m = u.match(/https?:\/\/[^\s]+tiktok\.com[^\s]*/i)?.[0] || u; if (!seen.has(m) && m.includes("tiktok.com")) { seen.add(m); dedup.push(m); } }
                      if (dedup.length) setTiktokLinks(prev => { const s = new Set(prev); const add = dedup.filter(x=>!s.has(x)); return [...prev, ...add].slice(0,5); });
                    }}
                  />
                  <button
                    onClick={async () => {
                      const ta = document.getElementById("tiktok-paste-links") as HTMLTextAreaElement | null;
                      const raw = ta?.value?.trim() || "";
                      if (!raw) { setTiktokError("Pega al menos un enlace de TikTok arriba"); return; }
                      const urls = raw.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean).map(u=>u.match(/https?:\/\/[^\s]+tiktok\.com[^\s]*/i)?.[0] || u).filter(u=>u.includes("tiktok.com"));
                      if (!urls.length) { setTiktokError("Pega enlaces válidos de tiktok.com"); return; }
                      setTiktokLinks(urls.slice(0,5));
                      // Dispara descarga sin marca vía servidor
                      setTimeout(() => handleTikTokDownload(), 150);
                    }}
                    className="w-full py-2.5 bg-white text-black rounded-full text-xs font-bold hover:bg-zinc-100 transition"
                  >
                    Pegar y descargar sin marca ↓
                  </button>
                  {tiktokLinks.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tiktokLinks.map((u,i) => (
                        <span key={i} className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-1 text-[10px] truncate max-w-[160px]">{u.slice(0,38)}… <button onClick={()=>handleRemoveLink(i)} className="w-4 h-4 bg-zinc-700 rounded-full flex items-center justify-center">✕</button></span>
                      ))}
                    </div>
                  )}
                  {tiktokError && <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-2 py-1">{tiktokError}</div>}
                  {tiktokLoading && <div className="text-xs text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />{status}</div>}
                </div>
              )}

              {autoResults.length > 0 && (
                <div className="w-full space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {autoResults.map((r, idx) => (
                      <button
                        key={r.id}
                        onClick={() => toggleAutoSelect(idx)}
                        className={`relative rounded-2xl overflow-hidden border-2 aspect-[9/16] bg-black ${r.selected ? "border-purple-500" : "border-zinc-800"}`}
                      >
                        <video
                          src={r.play}
                          poster={r.cover}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="w-full h-full object-cover opacity-90"
                          onError={(e) => { const v = e.currentTarget; v.style.display = "none"; const img = v.nextElementSibling as HTMLElement; if (img) img.style.display = "block"; }}
                        />
                        <img src={r.cover} alt="" className="w-full h-full object-cover opacity-80 hidden" style={{ display: "none" }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${r.selected ? "bg-purple-500 border-purple-500 text-white" : "bg-black/50 border-white/50 text-white"}`}>{r.selected ? "✓" : ""}</div>
                        <div className="absolute bottom-1 left-1 right-1 text-[10px] text-white text-left leading-tight pointer-events-none">
                          <div className="truncate">{r.author}</div>
                          <div className="text-[9px] opacity-70">{r.duration.toFixed(1)}s · ♥{r.likes > 1000 ? `${(r.likes/1000).toFixed(1)}k` : r.likes}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleAutoUse}
                    disabled={tiktokLoading || autoResults.filter(r=>r.selected).length===0}
                    className="w-full py-3 bg-white text-black rounded-full font-bold text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 disabled:opacity-50 active:scale-[0.98] transition"
                  >
                    {tiktokLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</> : <>Usar {autoResults.filter(r=>r.selected).length} vídeos para viral</>}
                  </button>
                  <p className="text-[11px] text-zinc-500">Se descargarán sin marca y pasará a elegir Voz/Música</p>
                </div>
              )}
            </div>

            {/* TikTok manual minimalista - idéntico a subir vídeos */}
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
                <label className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 cursor-pointer hover:border-zinc-700 transition">
                  <input type="checkbox" checked={autoUpload} onChange={(e) => setAutoUpload(e.target.checked)} className="w-4 h-4 rounded accent-white" />
                  <span>Subir automáticamente a TikTok al crear</span>
                  <span className="ml-auto text-[10px] bg-zinc-800 px-2 py-0.5 rounded-full">Sin configurar</span>
                </label>
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

            {/* TikTok Content Posting API - real */}
            <div className="w-full mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.8.11V8.94a6.27 6.27 0 00-.8-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.2 8.2 0 004.77 1.52V6.84a4.83 4.83 0 01-1.01-.15z" /></svg>
                Publicar en TikTok
              </h4>
              {!tiktokConnected ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-400 text-left">Conecta tu cuenta para publicar directo sin salir de la web.</p>
                  <button
                    onClick={handleTikTokConnect}
                    className="w-full py-3 bg-white text-black rounded-full font-bold text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 transition"
                  >
                    Conectar TikTok
                  </button>
                  <button
                    onClick={handleShareTikTok}
                    className="w-full py-2.5 bg-zinc-800 border border-zinc-700 rounded-full text-xs font-medium flex items-center justify-center gap-2 hover:bg-zinc-700 transition"
                  >
                    <Link2 className="w-3 h-3" /> Compartir manual (sin conectar)
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTikTokPublish("publish")}
                      disabled={tiktokPublishing}
                      className="flex-1 py-3 bg-white text-black rounded-full font-bold text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 disabled:opacity-50 transition"
                    >
                      {tiktokPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Publicar directo
                    </button>
                    <button
                      onClick={() => handleTikTokPublish("draft")}
                      disabled={tiktokPublishing}
                      className="flex-1 py-3 bg-zinc-800 border border-zinc-700 rounded-full font-bold text-sm flex items-center justify-center gap-2 hover:bg-zinc-700 disabled:opacity-50 transition"
                    >
                      {tiktokPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Guardar borrador
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500 text-center">
                    {tiktokPublishing ? "Subiendo a TikTok..." : "Usa video.publish para directo o video.upload para borrador"}
                  </p>
                  {tiktokPublishMsg && (
                    <div className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 text-center whitespace-pre-wrap">
                      {tiktokPublishMsg}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
      {/* TikTok overlay por encima - automático, no redirige, con X */}
      {tiktokOverlayOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col p-2 sm:p-4">
          <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col max-w-5xl w-full mx-auto shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <span className="w-2 h-2 bg-[#fe2c55] rounded-full animate-pulse" /> TikTok — &quot;{tiktokOverlayQuery}&quot;
                <span className="hidden sm:inline text-zinc-500 font-normal">— pincha solo en la lupa, ignora &quot;Abrir app&quot;</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => window.open(`https://www.tiktok.com/search/video?q=${encodeURIComponent(tiktokOverlayQuery)}`, "_blank")} className="hidden sm:flex px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-full text-xs font-medium">Abrir en pestaña ↗</button>
                <button onClick={() => setTiktokOverlayOpen(false)} className="w-8 h-8 bg-zinc-800 hover:bg-zinc-700 rounded-full flex items-center justify-center text-white">✕</button>
              </div>
            </div>
            <div className="flex-1 relative bg-white">
              <iframe
                src={`${API_BASE}/api/tiktok/proxy?q=${encodeURIComponent(tiktokOverlayQuery)}`}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                allow="fullscreen"
                title="TikTok búsqueda"
              />
              <div className="absolute bottom-3 left-3 right-3 bg-zinc-950/95 backdrop-blur border border-zinc-800 rounded-2xl p-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <span className="text-xs text-zinc-400 flex-1">1) Pincha la lupa en TikTok 2) Copia 1-3 enlaces 3) Pégalos aquí ↓ y descarga sin marca</span>
                <button onClick={() => setTiktokOverlayOpen(false)} className="px-4 py-2 bg-white text-black rounded-full text-xs font-bold whitespace-nowrap">Cancelar</button>
                <button onClick={() => setTiktokOverlayOpen(false)} className="px-4 py-2 bg-[#fe2c55] text-white rounded-full text-xs font-bold whitespace-nowrap">Listo, pegar enlaces</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
