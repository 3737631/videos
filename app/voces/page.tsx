"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { VOICE_CATALOG } from "@/lib/tts";
import { useSettings } from "@/lib/useStore";

export default function VocesPage() {
  const [settings, update] = useSettings();

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Voces</h1>
        <p className="mt-1 text-sm text-gray-400">
          Voces de locución para tus vídeos. Las voces se generan con el proveedor TTS
          configurado (OpenAI o ElevenLabs).
        </p>

        <div className="mt-6 rounded-xl border border-white/10 p-4">
          <h2 className="font-semibold">Proveedor actual: {settings.ttsProvider}</h2>
          <p className="mt-1 text-sm text-gray-400">
            {settings.ttsApiKey ? "Clave configurada." : "Aún no hay clave de TTS."}{" "}
            <Link href="/configuracion" className="text-blue-400 hover:text-blue-300">
              Configurar →
            </Link>
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {VOICE_CATALOG.map((v) => (
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
                <button
                  onClick={() => update({ ttsVoiceId: v.id })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    settings.ttsVoiceId === v.id
                      ? "bg-blue-600 text-white"
                      : "bg-white/5 text-gray-300 hover:bg-white/10"
                  }`}
                >
                  {settings.ttsVoiceId === v.id ? "✓ Seleccionada" : "Usar"}
                </button>
              </div>
              <div className="mt-3 font-semibold">{v.name}</div>
              <div className="mt-1 text-xs text-gray-400">
                {v.style} · {v.language} ({v.accent})
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gray-300">
                  {v.gender}
                </span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gray-300">
                  {v.style}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}