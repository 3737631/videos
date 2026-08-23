"use client";

import { useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { buildLibrary, renderTrack, type TrackDef } from "@/lib/audio/musicLibrary";
import { MUSIC_CATEGORIES } from "@/lib/audio/musicLibrary";

const CATEGORY_INFO: Record<string, { label: string; emoji: string; desc: string }> = {
  viral: { label: "Viral", emoji: "🚀", desc: "Ritmo pegadizo para hooks y retención" },
  lifestyle: { label: "Lifestyle", emoji: "☕", desc: "Ambientado, rutinas y día a día" },
  romantic: { label: "Romántica", emoji: "💞", desc: "Suave y cálida" },
  mysterious: { label: "Misterio", emoji: "🌑", desc: "Tenso, secretos y teorías" },
  sad: { label: "Emotiva", emoji: "🌧️", desc: "Melódica, historias que llegan" },
  funny: { label: "Divertida", emoji: "😄", desc: "Alegre y cómica" },
  motivational: { label: "Motivacional", emoji: "💪", desc: "Empuje para logros y disciplina" },
  storytelling: { label: "Storytime", emoji: "📖", desc: "Narrativa con calma" },
  relaxing: { label: "Relajante", emoji: "🧘", desc: "ASMR, calma, dormir" },
  dramatic: { label: "Dramática", emoji: "⚡", desc: "Impacto y urgencia" },
};

export default function MusicaPage() {
  const lib = useMemo(() => buildLibrary(), []);
  const [cat, setCat] = useState<string>("viral");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const tracks = lib.filter((t) => t.category === cat);

  function stop() {
    try {
      audioRef.current?.pause();
      if (audioRef.current?.src.startsWith("blob:")) URL.revokeObjectURL(audioRef.current.src);
    } catch {}
    audioRef.current = null;
    setPlayingId(null);
    setLoadingId(null);
  }

  async function listen(t: TrackDef) {
    setError("");
    if (playingId === t.id || loadingId === t.id) {
      stop();
      return;
    }
    stop();
    setLoadingId(t.id);
    try {
      // Síntesis REAL en tu dispositivo: escuchas la pista completa tal cual sonará
      const rendered = await renderTrack(t, 14);
      const a = new Audio(rendered.url);
      audioRef.current = a;
      a.onended = stop;
      await a.play();
      setPlayingId(t.id);
      setLoadingId(null);
    } catch {
      setError("No se pudo generar esta pista en tu dispositivo.");
      setLoadingId(null);
    }
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Música</h1>
        <p className="mt-1 text-sm text-gray-400">
          Biblioteca propia de {lib.length} pistas originales (libres de derechos). Al crear un vídeo,
          la música se elige sola según tu guion — aquí puedes escuchar cómo suena cada estilo.
        </p>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          {MUSIC_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => {
                stop();
                setCat(c);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                cat === c ? "bg-blue-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              {CATEGORY_INFO[c]?.emoji} {CATEGORY_INFO[c]?.label || c}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
        )}

        <p className="mt-4 text-xs text-gray-500">{CATEGORY_INFO[cat]?.desc}</p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => listen(t)}
              disabled={loadingId !== null && loadingId !== t.id}
              className={`flex items-center justify-between rounded-xl border p-4 text-left transition-colors disabled:opacity-40 ${
                playingId === t.id ? "border-emerald-500 bg-emerald-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
              }`}
            >
              <div>
                <div className="text-sm font-semibold">Pista {t.index}</div>
                <div className="text-xs text-gray-400">
                  {CATEGORY_INFO[t.category]?.label} · variación {t.index}
                </div>
              </div>
              <span className="text-xs font-semibold text-gray-200">
                {loadingId === t.id ? "… Componiendo" : playingId === t.id ? "⏹ Parar" : "▶ Escuchar"}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-white/10 p-4 text-sm text-gray-400">
          ¿Por qué no se sube música? Las pistas subidas solían ignorarse al crear el vídeo.
          La música procedural es 100% original, se genera en tu dispositivo y nunca da problemas de derechos.
        </div>
      </div>
    </AppShell>
  );
}
