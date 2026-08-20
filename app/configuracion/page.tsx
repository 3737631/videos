"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSettings } from "@/lib/useStore";
import { serviceStatus } from "@/lib/storage";

function Field({
  label,
  hint,
  value,
  onChange,
  type = "password",
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1 flex gap-2">
        <input
          type={show ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-white/15 bg-[#131722] px-3 py-2 text-sm outline-none focus:border-blue-500"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="rounded-lg border border-white/15 px-3 text-xs hover:bg-white/5"
        >
          {show ? "Ocultar" : "Ver"}
        </button>
      </div>
      <span className="mt-1 block text-xs text-gray-400">{hint}</span>
    </label>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
      ● Configurado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
      ○ Sin configurar
    </span>
  );
}

export default function ConfiguracionPage() {
  const [settings, update] = useSettings();
  const llm = serviceStatus(settings, "llm");
  const tts = serviceStatus(settings, "tts");
  const stt = serviceStatus(settings, "stt");

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="mt-1 text-gray-400 text-sm">
          Las claves se guardan solo en este navegador (localStorage). Nunca se envían a
          ningún servidor fuera de los proveedores de IA.
        </p>

        <div className="mt-6 rounded-xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Texto e IA (LLM)</h2>
            <Badge ok={llm.configured} />
          </div>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Genera guiones, hooks y CTA. Usa tu clave de OpenAI o de Groq.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Proveedor"
              hint="openai o groq"
              type="text"
              value={settings.llmProvider}
              onChange={(v) => update({ llmProvider: v === "groq" ? "groq" : "openai" })}
            />
            <div className="md:col-span-2">
              <Field
                label="Clave de API"
                hint={llm.missing.join(", ") || "Ej: sk-..."}
                value={settings.llmApiKey}
                onChange={(v) => update({ llmApiKey: v })}
              />
            </div>
            <div className="md:col-span-3">
              <Field
                label="Modelo"
                hint="OpenAI: gpt-4o-mini | Groq: llama-3.3-70b-versatile"
                type="text"
                value={settings.llmModel}
                onChange={(v) => update({ llmModel: v })}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Voz (TTS)</h2>
            <Badge ok={tts.configured} />
          </div>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Genera la locución. OpenAI (tts-1) o ElevenLabs (mejor calidad).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Proveedor"
              hint="openai o elevenlabs"
              type="text"
              value={settings.ttsProvider}
              onChange={(v) => update({ ttsProvider: v === "elevenlabs" ? "elevenlabs" : "openai" })}
            />
            <div className="md:col-span-2">
              <Field
                label="Clave de API"
                hint={tts.missing.join(", ") || "Ej: sk-..."}
                value={settings.ttsApiKey}
                onChange={(v) => update({ ttsApiKey: v })}
              />
            </div>
            <div className="md:col-span-3">
              <Field
                label="ID de voz"
                hint="ElevenLabs: pega el voice_id (30 chars). OpenAI: alloy, echo, fable, onyx, nova, shimmer"
                type="text"
                value={settings.ttsVoiceId}
                onChange={(v) => update({ ttsVoiceId: v })}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Transcripción (STT)</h2>
            <Badge ok={stt.configured} />
          </div>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Convierte la locución en subtítulos palabra por palabra.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Proveedor"
              hint="openai o groq"
              type="text"
              value={settings.sttProvider}
              onChange={(v) => update({ sttProvider: v === "groq" ? "groq" : "openai" })}
            />
            <div className="md:col-span-2">
              <Field
                label="Clave de API"
                hint={stt.missing.join(", ") || "Ej: sk-..."}
                value={settings.sttApiKey}
                onChange={(v) => update({ sttApiKey: v })}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 p-5 text-sm text-gray-400">
          <h2 className="font-semibold text-gray-200">¿De dónde saco las claves?</h2>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>OpenAI: platform.openai.com → API keys (requiere saldo)</li>
            <li>Groq: console.groq.com → API Keys (gratis)</li>
            <li>ElevenLabs: elevenlabs.io → Profile → API Keys</li>
          </ul>
          <p className="mt-3">
            Puedes usar la misma clave de OpenAI para los tres servicios, o mezclar
            proveedores (ej. LLM y STT en Groq gratis + TTS en OpenAI).
          </p>
        </div>
      </div>
    </AppShell>
  );
}