"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { saveUserTrack, createMusicTrack } from "@/lib/music";

export default function MusicaPage() {
  const input = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useState<
    { id: string; name: string; duration: number; category: string; url: string }[]
  >([]);
  const [playing, setPlaying] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("audio/"));
    for (const f of list) {
      // Se guarda en el dispositivo: la pista queda disponible para los vídeos nuevos
      const t = (await saveUserTrack(f)) || (await createMusicTrack(f));
      setTracks((prev) => [...prev, t]);
    }
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Música</h1>
        <p className="mt-1 text-sm text-gray-400">
          Sube tus propias pistas (solo usa música que tengas licencia para usar).
        </p>

        <button
          onClick={() => input.current?.click()}
          className="mt-6 rounded-xl border-2 border-dashed border-white/15 p-8 w-full text-center hover:border-blue-400/50 transition-colors"
        >
          <div className="text-3xl">🎵</div>
          <div className="mt-2 text-sm">Subir música</div>
          <div className="text-xs text-gray-400 mt-1">MP3, WAV, M4A</div>
          <input
            ref={input}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </button>

        {tracks.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 p-8 text-center text-gray-400 text-sm">
            Aún no hay pistas. La música se mezcla con la voz con volumen ajustable en el
            export.
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            {tracks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 p-3"
              >
                <button
                  onClick={() => {
                    if (playing === t.id) {
                      setPlaying(null);
                    } else {
                      setPlaying(t.id);
                      const a = new Audio(t.url);
                      a.onended = () => setPlaying(null);
                      a.play();
                    }
                  }}
                  className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-sm hover:bg-blue-500"
                  aria-label={playing === t.id ? "Pausar" : "Reproducir"}
                >
                  {playing === t.id ? "⏸" : "▶"}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm">{t.name}</div>
                  <div className="text-xs text-gray-400">{t.duration.toFixed(1)}s</div>
                </div>
                <span className="rounded bg-white/5 px-2 py-1 text-xs text-gray-300">
                  {t.category}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-gray-500">
          No uses música con copyright sin licencia. Para añadir música a un proyecto, abre
          el vídeo en el editor y usa la pista correspondiente en la línea de tiempo.
        </p>
      </div>
    </AppShell>
  );
}