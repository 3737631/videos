"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { VOICE_CATALOG, previewVoice, stopPreview, voiceAvailability } from "@/lib/tts";
import { useSettings } from "@/lib/useStore";
import { hasBackend } from "@/lib/apiClient";

export default function VocesPage() {
  const [settings, update] = useSettings();
  const [filter, setFilter] = useState<string>("Español");
  const LANGS = ["English", "Español", "Français", "Deutsch", "Italiano", "Português"] as const;
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const voices = VOICE_CATALOG.filter((v) => v.language === filter);

  async function listen(id: string) {
    setError("");
    if (playingId === id || loadingId === id) {
      stopPreview();
      setPlayingId(null);
      setLoadingId(null);
      return;
    }
    stopPreview();
    setPlayingId(null);
    setLoadingId(id);
    const ok = await previewVoice(id); // pipeline REAL: servidor → clave propia → local
    setLoadingId(null);
    if (ok) setPlayingId(id);
    else setError("No se pudo reproducir esta vista previa ahora mismo.");
  }

  function stop() {
    stopPreview();
    setPlayingId(null);
    setLoadingId(null);
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/crear" className="inline-flex items-center gap-1 text-sm text-gray-300 hover:text-white transition">
          ← Atrás
        </Link>
        <h1 className="mt-3 text-2xl font-bold">Voces</h1>
        <p className="mt-1 text-sm text-gray-400">
          Escucha y elige la voz para tus vídeos. La vista previa usa exactamente la misma voz que oirás en el vídeo final.
        </p>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          {LANGS.map((lang) => (
            <button
              key={lang}
              onClick={() => {
                stop();
                setFilter(lang);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === lang ? "bg-blue-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              {lang}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
        )}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {voices.map((v) => (
            <div
              key={v.id}
              className={`rounded-xl border p-5 transition-colors ${
                settings.ttsVoiceId === v.id ? "border-blue-500 bg-blue-500/10" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-2xl">{v.gender === "femenina" ? "👩" : "👨"}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => listen(v.id)}
                    aria-label={`Escuchar ${v.name}`}
                    disabled={loadingId !== null && loadingId !== v.id}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                      playingId === v.id
                        ? "bg-emerald-600 text-white"
                        : "bg-white/10 text-gray-200 hover:bg-white/20"
                    }`}
                  >
                    {loadingId === v.id ? "… Generando" : playingId === v.id ? "⏹ Parar" : "▶ Escuchar"}
                  </button>
                  <button
                    onClick={() => {
                      stop();
                      update({ ttsVoiceId: v.id });
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      settings.ttsVoiceId === v.id ? "bg-blue-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
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

        <VoiceFooter />
      </div>
    </AppShell>
  );
}

function VoiceFooter() {
  const [settings] = useSettings();
  const avail = voiceAvailability(settings, settings.ttsVoiceId);
  return (
    <div className="mt-8 rounded-xl border border-white/10 p-4 text-sm text-gray-400">
      Proveedor activo para tus vídeos: <span className="text-gray-200">{avail.providerLabel}</span>
      {!hasBackend() && !settings.ttsApiKey && (
        <>
          {" · "}
          <Link href="/configuracion" className="text-blue-400 hover:text-blue-300">
            Configurar servidor o clave →
          </Link>
        </>
      )}
    </div>
  );
}
