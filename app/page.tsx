"use client";

import { useState, useRef } from "react";
import { UploadCloud, Music, Mic, Wand2, Download, RefreshCcw } from "lucide-react";
import { VideoClip, AppMode } from "@/types";
import { renderFinalVideo } from "@/lib/videoEngine";
import { generateSpeechAndCues } from "@/lib/ttsEngine";

export default function App() {
  const [step, setStep] = useState(1);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [mode, setMode] = useState<AppMode | null>(null);
  const [productPrompt, setProductPrompt] = useState("");
  const [totalDuration, setTotalDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const newClips: VideoClip[] = [];
    let dur = 0;
    
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const videoDur = await new Promise<number>((res) => {
        const v = document.createElement("video");
        v.src = url;
        v.onloadedmetadata = () => res(v.duration || 3);
        v.onerror = () => res(3);
      });
      newClips.push({ file, url, duration: videoDur });
      dur += videoDur;
    }
    
    setClips(newClips);
    setTotalDuration(Math.max(5, Math.round(dur)));
    setStep(2);
  };

  const processVideo = async () => {
    setStep(4);
    setProgress(5);
    setStatus("Analizando metadatos y silenciando audios...");

    try {
      let audioBlob = null;
      let cues: any = [];

      if (mode === "voice") {
        setStatus("Generando guion viral sin marcas...");
        const res = await fetch("/api/script", {
          method: "POST",
          body: JSON.stringify({ productInfo: productPrompt, durationSeconds: totalDuration }),
        });
        const data = await res.json();
        
        setStatus("Sintetizando voz de IA y subtítulos...");
        const tts = await generateSpeechAndCues(data.script, totalDuration);
        audioBlob = tts.audioBlob;
        cues = tts.cues;
      }

      setStatus("Renderizando píxeles a 60FPS (Anti-bloqueo Safari)...");
      const url = await renderFinalVideo({
        clips, audioBlob, cues, mode: mode!, targetDuration: totalDuration,
        onProgress: (p) => setProgress(Math.round(p))
      });

      setFinalVideo(url);
      setStep(5);
    } catch (e) {
      alert("Error en el render. Intenta subir vídeos más ligeros.");
      setStep(1);
    }
  };

  return (
    <main className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6">
      
      <div className="w-full max-w-xl text-center mb-8">
        <div className="inline-block bg-purple-500/10 border border-purple-500/30 text-purple-400 px-4 py-1 rounded-full text-xs font-bold mb-4 tracking-widest">
          TIKTOK AUTOMATOR 3.0
        </div>
        <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">
          Crea Vídeos Virales
        </h1>
      </div>

      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-[2rem] p-8 shadow-2xl relative overflow-hidden">
        
        {step === 1 && (
          <div onClick={() => fileInput.current?.click()} className="border-2 border-dashed border-zinc-700 hover:border-purple-500 bg-zinc-950/50 rounded-3xl p-12 flex flex-col items-center cursor-pointer transition-all group">
            <input type="file" ref={fileInput} onChange={(e) => handleUpload(e.target.files)} multiple accept="video/*" className="hidden" />
            <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <UploadCloud className="w-10 h-10 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold">Arrastra tus clips en bruto</h2>
            <p className="text-zinc-500 mt-2 text-sm text-center">Formato vertical MP4 o MOV. Los uniremos automáticamente.</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold mb-4">¿Qué formato quieres crear?</h2>
            <button onClick={() => { setMode("music"); setStep(3); }} className="w-full p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-blue-500 transition-all">
              <div className="p-4 bg-blue-500/10 rounded-full"><Music className="text-blue-400" /></div>
              <div className="text-left">
                <h3 className="font-bold text-lg">Modo Musical</h3>
                <p className="text-zinc-500 text-sm">Cortes dinámicos sin voz. Ideal para Lifestyle.</p>
              </div>
            </button>
            <button onClick={() => { setMode("voice"); setStep(3); }} className="w-full p-6 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:border-purple-500 transition-all">
              <div className="p-4 bg-purple-500/10 rounded-full"><Mic className="text-purple-400" /></div>
              <div className="text-left">
                <h3 className="font-bold text-lg">Modo Narrador IA</h3>
                <p className="text-zinc-500 text-sm">Guion de producto + Voz + Subtítulos virales.</p>
              </div>
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {mode === "voice" && (
              <>
                <label className="font-bold text-lg">Describe el producto</label>
                <p className="text-zinc-500 text-sm">Crearemos un guion de exactamente {totalDuration}s sin mencionar marcas.</p>
                <textarea 
                  value={productPrompt} onChange={(e) => setProductPrompt(e.target.value)}
                  placeholder="Ej: Aspiradora portátil para el coche que absorbe líquidos..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 focus:border-purple-500 outline-none h-32 resize-none"
                />
              </>
            )}
            <button onClick={processVideo} disabled={mode === "voice" && productPrompt.length < 5} className="w-full py-4 bg-white text-black rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:bg-zinc-200 disabled:opacity-50">
              <Wand2 className="w-5 h-5" /> Generar Vídeo Mágico
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="py-12 flex flex-col items-center">
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 border-4 border-zinc-800 border-t-purple-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center font-bold font-mono">{progress}%</div>
            </div>
            <h2 className="text-xl font-bold">Creando magia...</h2>
            <p className="text-zinc-500 text-sm mt-2">{status}</p>
            <div className="w-full h-2 bg-zinc-800 rounded-full mt-6 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}

        {step === 5 && finalVideo && (
          <div className="flex flex-col items-center animate-in zoom-in duration-500">
            <div className="w-[280px] h-[498px] bg-black rounded-[2rem] overflow-hidden border-4 border-zinc-800 shadow-2xl relative mb-8">
              <video src={finalVideo} controls autoPlay loop playsInline className="w-full h-full object-cover" />
            </div>
            <div className="flex w-full gap-4">
              <button onClick={() => { setStep(1); setClips([]); }} className="flex-1 py-4 bg-zinc-800 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-700">
                <RefreshCcw className="w-5 h-5" /> Otro
              </button>
              <a href={finalVideo} download="tiktok-viral.mp4" className="flex-1 py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold flex items-center justify-center gap-2">
                <Download className="w-5 h-5" /> Guardar
              </a>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
