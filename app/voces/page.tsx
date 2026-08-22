"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { VOICE_CATALOG, previewVoice, stopPreview, getVoiceById } from "@/lib/tts";
import { useSettings } from "@/lib/useStore";

export default function VocesPage() {
  const [settings, update] = useSettings();
  const [filter, setFilter] = useState<"English" | "Español">("English");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const voices = VOICE_CATALOG.filter((v) => v.language === filter);

  function listen(id: string) {
    if (playingId === id) {
      stopPreview();
      setPlayingId(null);
      return;
    }
    stopPreview();
    const ok = previewVoice(getVoiceById(id));
    setPlayingId(ok ? id : null);
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Voces</h1>
        <p className="mt-1 text-sm text-gray-400">
          Pulsa ▶ para escuchar cada voz (vista previa gratuita, sin claves). La voz
          seleccionada se usará al crear tus vídeos.
        </p>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          {(["English", "Español"] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => {
                stopPreview();
                setPlayingId(null);
                setFilter(lang);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === lang
                  ? "bg-blue-600 text-white"
                  : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              {lang === "English" ? "🇺🇸 English" : "🇪🇸 Español"}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {voices.map((v) => (
            <div
              key={v.id}
              className={`rounded-xl border p-5 transition-colors ${
                settings.ttsVoiceId === v.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-2xl">
                  {v.gender === "femenina" ? "👩" : v.gender === "masculina" ? "👨" : "🧑"}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => listen(v.id)}
                    aria-label={`Escuchar ${v.name}`}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      playingId === v.id
                        ? "bg-emerald-600 text-white"
                        : "bg-white/10 text-gray-200 hover:bg-white/20"
                    }`}
                  >
                    {playingId === v.id ? "⏹ Parar" : "▶ Escuchar"}
                  </button>
                  <button
                    onClick={() => update({ ttsVoiceId: v.id })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      settings.ttsVoiceId === v.id
                        ? "bg-blue-600 text-white"
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {settings.ttsVoiceId === v.id ? "✓ Elegida" : "Usar"}
                  </button>
                </div>
              </div>
              <div className="mt-3 font-semibold">{v.name}</div>
              <div className="mt-1 text-xs text-gray-400">
                {v.style} · {v.language} ({v.accent})
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-white/10 p-4 text-sm text-gray-400">
          Proveedor de voz final: <span className="text-gray-200">{settings.ttsProvider}</span>{" "}
          ·{" "}
          {settings.ttsApiKey ? "clave configurada ✓" : "sin clave (solo vista previa)"}{" "}
          <Link href="/configuracion" className="text-blue-400 hover:text-blue-300">
            Configurar →
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
