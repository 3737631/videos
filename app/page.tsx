"use client";

import { useState, useRef } from "react";
import { UploadCloud, Music, Mic, Wand2, Download, RefreshCcw, Globe } from "lucide-react";
import { VideoClip, AppMode } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues, generateViralMusic } from "@/lib/ttsEngine";

export default function App() {
  const [step, setStep] = useState(1);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [mode, setMode] = useState<AppMode | null>(null);
  const [productPrompt, setProductPrompt] = useState("");
  const [language, setLanguage] = useState("es"); 
  const [totalDuration, setTotalDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const clearMemory = () => {
    const uniqueUrls = new Set(clips.map(c => c.url));
    uniqueUrls.forEach(url => URL.revokeObjectURL(url));
    if (finalVideo) URL.revokeObjectURL(finalVideo);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    clearMemory();
    
    const rawVideos: {file: File, url: string, dur: number}[] = [];
    const lector = document.createElement("video");
    lector.playsInline = true;
    lector.muted = true;
    
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      lector.src = url;
      const videoDur = await new Promise<number>((res) => {
        lector.onloadedmetadata = () => res(lector.duration || 3);
        lector.onerror = () => res(3);
        setTimeout(() => res(3), 1000); 
      });
      rawVideos.push({ file, url, dur: videoDur });
    }
    lector.removeAttribute("src"); 
    lector.load();

    let viralCuts: VideoClip[] = [];
    const cutLength = 2.0; 

    rawVideos.forEach(raw => {
      const numCuts = Math.floor(raw.dur / cutLength);
      if (numCuts <= 1) {
        viralCuts.push({ file: raw.file, url: raw.url, startOffset: 0, playDuration: raw.dur });
      } else {
        for (let i = 0; i < Math.min(numCuts, 8); i++) {
          let offset = (raw.dur / numCuts) * i;
          viralCuts.push({
            file: raw.file,
            url: raw.url,
            startOffset: Math.min(offset + 0.5, raw.dur - cutLength),
            playDuration: cutLength
          });
        }
      }
    });

    if (rawVideos.length > 1) {
      viralCuts = viralCuts.sort(() => Math.random() - 0.5);
    }

    let finalPlaylist: VideoClip[] = [];
    let accDur = 0;
    for (const cut of viralCuts) {
      if (accDur >= 20) break; 
      finalPlaylist.push(cut);
      accDur += cut.playDuration;
    }

    setClips(finalPlaylist);
    setTotalDuration(Math.max(5, Math.round(accDur)));
    setStep(2);
  };

  const generateScriptLocal = (info: string, durationSeconds: number, lang: string) => {
    const targetWordCount = Math.floor(durationSeconds * 3.4); 

    const cleanInfo = info
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/(aliexpress|amazon|shein|temu|tienda|comprar|vendedor|descuento|link|bio)/gi, "")
      .trim() || "este producto";

    const data: Record<string, { hooks: string[], benefits: string[], calls: string[], fill: string }> = {
      es: {
        hooks: [`¿Cansado de los mismos problemas? Necesitas ${cleanInfo}.`, `El secreto que nadie te quiere contar sobre ${cleanInfo}.`, `Mira cómo ${cleanInfo} me salvó el día.`],
        benefits: ["Te ahorra horas de esfuerzo y es súper fácil de usar.", "La calidad te dejará con la boca abierta desde el primer uso.", "Es el mejor invento del año y funciona a la perfección."],
        calls: ["Consíguelo hoy y cambia tu rutina.", "Pruébalo ahora, no te arrepentirás.", "Hazte un favor y empieza a usarlo."],
        fill: "¡Funciona increíble!"
      },
      en: {
        hooks: [`Tired of the same problems? You need ${cleanInfo}.`, `The secret nobody tells you about ${cleanInfo}.`, `Look how ${cleanInfo} totally saved my day.`],
        benefits: ["It saves you hours of effort and is super easy to use.", "The quality will blow your mind from the very first use.", "It's the best invention of the year and works flawlessly."],
        calls: ["Get it today and change your routine.", "Try it now, you won't regret it.", "Do yourself a favor and start using it."],
        fill: "It works amazingly!"
      },
      pt: {
        hooks: [`Cansado dos mesmos problemas? Você precisa de ${cleanInfo}.`, `O segredo que ninguém te conta sobre ${cleanInfo}.`, `Olha como ${cleanInfo} salvou meu dia.`],
        benefits: ["Economiza horas de esforço e é super fácil de usar.", "A qualidade vai te deixar de queixo caído desde o primeiro uso.", "É a melhor invenção do ano e funciona perfeitamente."],
        calls: ["Garanta o seu hoje e mude sua rotina.", "Experimente agora, você não vai se arrepender.", "Faça um favor a si mesmo e comece a usar."],
        fill: "Funciona incrivelmente!"
      },
      fr: {
        hooks: [`Fatigué des mêmes problèmes? Vous avez besoin de ${cleanInfo}.`, `Le secret que personne ne vous dit sur ${cleanInfo}.`, `Regardez comment ${cleanInfo} a sauvé ma journée.`],
        benefits: ["Cela vous fait gagner des heures d'efforts et est super facile à utiliser.", "La qualité vous époustouflera dès la première utilisation.", "C'est la meilleure invention de l'année et fonctionne parfaitement."],
        calls: ["Obtenez-le aujourd'hui et changez votre routine.", "Essayez-le maintenant, vous ne le regretterez pas.", "Faites-vous une faveur et commencez à l'utiliser."],
        fill: "Ça marche incroyablement!"
      }
    };

    const d = data[lang] || data["es"];
    
    let script = d.hooks[Math.floor(Math.random() * d.hooks.length)];
    let words = script.split(" ");
    
    let benefitCount = 0;
    while (words.length < targetWordCount - 6) { 
      script += " " + d.benefits[benefitCount % d.benefits.length];
      words = script.split(" ");
      benefitCount++;
    }

    script += " " + d.calls[Math.floor(Math.random() * d.calls.length)];
    words = script.split(" ");

    if (words.length > targetWordCount) {
      return words.slice(0, targetWordCount).join(" ") + "!";
    } else {
      while (words.length < targetWordCount) {
        script += " " + d.fill;
        words = script.split(" ");
      }
    }
    
    return script;
  };

  const processVideo = async () => {
    setStep(4);
    setProgress(5);
    setStatus("Preparando motores...");

    try {
      let audioBlob = null;
      let cues: any = [];

      if (mode === "voice") {
        setStatus("Generando guion a medida...");
        const script = generateScriptLocal(productPrompt, totalDuration, language);
        
        setStatus("Sintetizando voz nativa...");
        const tts = await generateSpeechAndCues(script, totalDuration, language);
        audioBlob = tts.audioBlob;
        cues = tts.cues;
      } else {
        setStatus("Generando base musical Lo-Fi...");
        audioBlob = await generateViralMusic(totalDuration);
      }

      setStatus("Ensamblando cortes a máxima velocidad...");
      const url = await renderFinalVideo({
        clips, audioBlob, cues, mode: mode!, targetDuration: totalDuration,
        onProgress: (p) => setProgress(Math.round(p))
      });

      setFinalVideo(url);
      setStep(5);
    } catch (e: any) {
      console.error(e);
      alert("Error: " + e.message);
      setStep(1);
    }
  };

  const resetAll = () => {
    clearMemory();
    setClips([]);
    setFinalVideo(null);
    setStep(1);
  };

  return (
    <main className="min-h-[100dvh] bg-[#09090b] text-white flex flex-col items-center justify-center p-4 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-xl text-center mb-6 sm:mb-8 mt-4">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold mb-3 sm:mb-4 tracking-widest">
          TIKTOK AUTOMATOR FINAL PRO GLOBAL
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent leading-tight">
          Creador Viral
        </h1>
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 shadow-2xl relative overflow-hidden">
        
        {step === 1 && (
          <div onClick={() => fileInput.current?.click()} className="border-2 border-dashed border-zinc-700 hover:border-purple-500 bg-zinc-950/50 rounded-2xl sm:rounded-3xl p-8 sm:p-12 flex flex-col items-center cursor-pointer transition-all active:scale-95 touch-manipulation">
            <input type="file" ref={fileInput} onChange={(e) => handleUpload(e.target.files)} multiple accept="video/*" className="hidden" />
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-4 transition-transform">
              <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10 text-purple-400" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-center">Toca para subir vídeos</h2>
            <p className="text-zinc-500 mt-2 text-xs sm:text-sm text-center">Cortes virales instantáneos.</p>
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
                <p className="text-zinc-500 text-xs sm:text-sm line-clamp-2">Guion, voz humana y subtítulos.</p>
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
            <h2 className="text-lg sm:text-xl font-bold text-center">Exportando vídeo...</h2>
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
              <a href={finalVideo} download={`tiktok-viral-${language}.mp4`} className="flex-1 py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2 text-sm sm:text-base touch-manipulation">
                <Download className="w-4 h-4 sm:w-5 sm:h-5" /> Guardar
              </a>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
