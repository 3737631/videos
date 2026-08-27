"use client";

import { useState, useRef } from "react";
import {
  UploadCloud,
  Music,
  Mic,
  Wand2,
  Download,
  RefreshCcw,
  Globe,
} from "lucide-react";
import { VideoClip, AppMode } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues, generateViralMusic } from "@/lib/ttsEngine";

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
  const fileInput = useRef<HTMLInputElement>(null);

  const clearMemory = (keepFinalVideo = false) => {
    for (const clip of clips) {
      try {
        URL.revokeObjectURL(clip.url);
      } catch {}
    }
    if (!keepFinalVideo && finalVideo) {
      try {
        URL.revokeObjectURL(finalVideo);
      } catch {}
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;

    clearMemory();

    const fileArray = Array.from(files).slice(0, 6);
    const newClips: VideoClip[] = [];
    let accDur = 0;

    for (const file of fileArray) {
      if (!file.type.startsWith("video/")) continue;

      const url = URL.createObjectURL(file);

      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.muted = true;
      probe.playsInline = true;
      probe.src = url;

      const duration = await new Promise<number>((resolve) => {
        let done = false;
        const finish = (d: number) => {
          if (done) return;
          done = true;
          resolve(d);
        };
        const timer = setTimeout(() => finish(3), 4000);
        probe.onloadedmetadata = () => {
          clearTimeout(timer);
          const d = Number.isFinite(probe.duration) ? probe.duration : 3;
          finish(Math.max(0.5, d));
        };
        probe.onerror = () => {
          clearTimeout(timer);
          finish(3);
        };
      });

      // Remove probe element to free memory, but keep URL for clip
      try {
        probe.removeAttribute("src");
        probe.load();
      } catch {}

      newClips.push({
        file,
        url,
        startOffset: 0,
        playDuration: duration,
      });
      accDur += duration;
    }

    if (newClips.length === 0) {
      alert("No se pudo leer ningún vídeo válido.");
      return;
    }

    setClips(newClips);
    setTotalDuration(Math.min(15, Math.max(8, Math.round(accDur / Math.max(1, newClips.length) * 1.2))));
    // Fallback simple: average duration, ensure 8-15
    const avg = accDur / newClips.length;
    setTotalDuration(Math.min(15, Math.max(8, Math.round(avg * 1.5 + 2))));
    setStep(2);
  };

  const generateScriptLocal = (info: string, lang: string) => {
    const cleanInfo = info.replace(/https?:\/\/\S+/gi, "").trim() || "este producto";

    const data: Record<string, { hooks: string[]; benefits: string[]; calls: string[] }> = {
      es: {
        hooks: [
          `¿Sigues teniendo problemas con ${cleanInfo}? Esta solución está diseñada para hacerlo mucho más fácil.`,
          `Descubre cómo ${cleanInfo} puede ayudarte en el día a día.`,
          `Si buscas una forma práctica de mejorar con ${cleanInfo}, esto te interesa.`,
        ],
        benefits: [
          "Es práctica, rápida y perfecta para el día a día.",
          "Está pensada para ahorrarte tiempo y esfuerzo.",
          "Su diseño sencillo la hace muy fácil de usar.",
        ],
        calls: [
          "Pruébala ahora.",
          "Descubre más y pruébala hoy.",
          "Hazte con ella y compruébalo tú mismo.",
        ],
      },
      en: {
        hooks: [
          `Still dealing with problems with ${cleanInfo}? This solution is designed to make things much easier.`,
          `Discover how ${cleanInfo} can help you every day.`,
          `Looking for a practical way to improve with ${cleanInfo}?`,
        ],
        benefits: [
          "It's practical, fast and perfect for everyday use.",
          "Designed to save you time and effort.",
          "Simple to use and built for daily life.",
        ],
        calls: ["Try it today.", "Discover more today.", "Get yours now."],
      },
      pt: {
        hooks: [
          `Você ainda tem problemas com ${cleanInfo}? Esta solução foi criada para tornar tudo muito mais fácil.`,
          `Descubra como ${cleanInfo} pode ajudar no dia a dia.`,
          `Procura uma forma prática com ${cleanInfo}?`,
        ],
        benefits: [
          "É prática, rápida e perfeita para o dia a dia.",
          "Foi pensada para economizar tempo e esforço.",
          "Design simples e fácil de usar.",
        ],
        calls: ["Experimente agora.", "Descubra hoje mesmo.", "Garanta a sua."],
      },
      fr: {
        hooks: [
          `Vous rencontrez encore des problèmes avec ${cleanInfo} ? Cette solution est conçue pour vous simplifier la vie.`,
          `Découvrez comment ${cleanInfo} peut vous aider au quotidien.`,
          `Vous cherchez une solution pratique avec ${cleanInfo} ?`,
        ],
        benefits: [
          "Elle est pratique, rapide et parfaite au quotidien.",
          "Conçue pour vous faire gagner du temps.",
          "Simple d'utilisation au quotidien.",
        ],
        calls: ["Essayez-la maintenant.", "Découvrez-la aujourd'hui.", "Obtenez-la maintenant."],
      },
    };

    const d = data[lang] || data.es;
    const h = d.hooks[Math.floor(Math.random() * d.hooks.length)];
    const b = d.benefits[Math.floor(Math.random() * d.benefits.length)];
    const c = d.calls[Math.floor(Math.random() * d.calls.length)];

    return `${h} ${b} ${c}`;
  };

  const getExtensionForMime = (mime: string) => {
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("ogg")) return "ogv";
    return "webm";
  };

  const processVideo = async () => {
    if (clips.length === 0) {
      alert("Sube al menos un vídeo.");
      return;
    }

    if (mode === "voice" && productPrompt.trim().length < 5) {
      alert("Describe el producto con al menos 5 caracteres.");
      return;
    }

    setStep(4);
    setProgress(5);
    setStatus(mode === "voice" ? "Generando voz..." : "Generando música...");

    let audioBlob: Blob | null = null;
    let wordChunks: string[] = [];
    let effectiveDuration = totalDuration;

    try {
      if (mode === "voice") {
        setStatus(`Generando voz en ${language.toUpperCase()}...`);
        const script = generateScriptLocal(productPrompt, language);
        const tts = await generateSpeechAndCues(script, language);
        audioBlob = tts.audioBlob;
        wordChunks = tts.wordChunks;

        // Estimar duración real del audio para sincronizar vídeo si es posible
        try {
          const ac = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext)();
          const ab = await audioBlob.arrayBuffer();
          const decoded = await ac.decodeAudioData(ab.slice(0));
          if (decoded.duration > 1) {
            effectiveDuration = Math.max(8, Math.min(20, decoded.duration / 1.15));
          }
          await ac.close();
        } catch {
          // fallback keep totalDuration
        }
      } else {
        setStatus("Generando base musical...");
        audioBlob = await generateViralMusic(totalDuration);
        effectiveDuration = totalDuration;
      }

      setStatus("Renderizando vídeo final a 30 FPS...");
      const url = await renderFinalVideo({
        clips,
        audioBlob,
        wordChunks,
        mode: mode as AppMode,
        targetDuration: effectiveDuration,
        onProgress: (p: number) => setProgress(Math.round(p)),
      });

      // Detectar MIME real del blob final
      try {
        const head = await fetch(url).then((r) => r.blob());
        const mime = head.type || "video/webm";
        setVideoMimeType(mime);
      } catch {
        setVideoMimeType("video/webm");
      }

      setFinalVideo(url);
      setStep(5);
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : "Ocurrió un error al procesar el vídeo.";
      // Detectar AdBlock / fetch bloqueado
      if (
        message.includes("No se pudo conectar") ||
        message.includes("bloqueador")
      ) {
        alert(
          "No se pudo generar la voz. Desactiva temporalmente el bloqueador para esta página o vuelve a intentarlo."
        );
      } else {
        alert("Error: " + message);
      }
      setStep(3);
    }
  };

  const resetAll = () => {
    clearMemory(true);
    if (finalVideo) {
      try {
        URL.revokeObjectURL(finalVideo);
      } catch {}
    }
    setClips([]);
    setFinalVideo(null);
    setVideoMimeType("video/webm");
    setProgress(0);
    setStatus("");
    setStep(1);
  };

  const downloadExt = getExtensionForMime(videoMimeType);

  return (
    <main className="min-h-[100dvh] bg-[#09090b] text-white flex flex-col items-center justify-center p-4 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-xl text-center mb-6 sm:mb-8 mt-4">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold mb-3 sm:mb-4 tracking-widest">
          TIKTOK AUTOMATOR FINAL (ESTABLE & SEGURO)
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent leading-tight">
          Creador Viral
        </h1>
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 shadow-2xl relative overflow-hidden">
        {step === 1 && (
          <div
            onClick={() => fileInput.current?.click()}
            className="border-2 border-dashed border-zinc-700 hover:border-purple-500 bg-zinc-950/50 rounded-2xl sm:rounded-3xl p-8 sm:p-12 flex flex-col items-center cursor-pointer transition-all active:scale-95 touch-manipulation"
          >
            <input
              type="file"
              ref={fileInput}
              onChange={(e) => handleUpload(e.target.files)}
              multiple
              accept="video/*"
              className="hidden"
            />
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-4">
              <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10 text-purple-400" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-center">Toca para subir vídeos</h2>
            <p className="text-zinc-500 mt-2 text-xs sm:text-sm text-center">MP4, MOV, WebM. Máx 6 vídeos.</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg sm:text-xl font-bold mb-4">¿Qué formato quieres crear?</h2>
            <button
              onClick={() => {
                setMode("music");
                setStep(3);
              }}
              className="w-full p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-blue-500 active:bg-blue-900/20 transition-all"
            >
              <div className="p-3 sm:p-4 bg-blue-500/10 rounded-full shrink-0">
                <Music className="text-blue-400 w-6 h-6" />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-base sm:text-lg">Modo Musical</h3>
                <p className="text-zinc-500 text-xs sm:text-sm">Cortes rápidos + Beat autogenerado.</p>
              </div>
            </button>
            <button
              onClick={() => {
                setMode("voice");
                setStep(3);
              }}
              className="w-full p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-purple-500 active:bg-purple-900/20 transition-all"
            >
              <div className="p-3 sm:p-4 bg-purple-500/10 rounded-full shrink-0">
                <Mic className="text-purple-400 w-6 h-6" />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-base sm:text-lg">Modo Narrador IA</h3>
                <p className="text-zinc-500 text-xs sm:text-sm">Guion, voz humana y subtítulos.</p>
              </div>
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
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
                  value={productPrompt}
                  onChange={(e) => setProductPrompt(e.target.value)}
                  placeholder="Ej: Aspiradora portátil para coche, fácil de usar y muy práctica..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 sm:p-4 focus:border-purple-500 outline-none h-28 sm:h-32 resize-none text-sm sm:text-base"
                />
              </>
            )}
            {mode === "music" && (
              <p className="text-sm text-zinc-400">Se generará música procedural y cortes automáticos.</p>
            )}
            <button
              onClick={processVideo}
              disabled={mode === "voice" && productPrompt.trim().length < 5}
              className="w-full py-3 sm:py-4 bg-white text-black rounded-xl font-bold text-base sm:text-lg flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <Wand2 className="w-5 h-5" /> Crear Vídeo
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="py-8 sm:py-12 flex flex-col items-center">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 mb-6">
              <div className="absolute inset-0 border-4 border-zinc-800 border-t-purple-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center font-bold font-mono text-sm sm:text-base">
                {progress}%
              </div>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-center">Exportando vídeo...</h2>
            <p className="text-zinc-500 text-xs sm:text-sm mt-2 text-center px-4">{status}</p>
          </div>
        )}

        {step === 5 && finalVideo && (
          <div className="flex flex-col items-center">
            <div className="w-[240px] h-[426px] sm:w-[280px] sm:h-[498px] bg-black rounded-2xl sm:rounded-[2rem] overflow-hidden border-2 sm:border-4 border-zinc-800 shadow-2xl relative mb-6 sm:mb-8">
              <video
                src={finalVideo}
                controls
                autoPlay
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex w-full gap-3 sm:gap-4">
              <button
                onClick={resetAll}
                className="flex-1 py-3 sm:py-4 bg-zinc-800 rounded-xl font-bold flex items-center justify-center gap-2 active:bg-zinc-700 text-sm sm:text-base"
              >
                <RefreshCcw className="w-4 h-4 sm:w-5 sm:h-5" /> Otro
              </button>
              <a
                href={finalVideo}
                download={`tiktok-viral-${language}.${downloadExt}`}
                className="flex-1 py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2 text-sm sm:text-base"
              >
                <Download className="w-4 h-4 sm:w-5 sm:h-5" /> Guardar
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
