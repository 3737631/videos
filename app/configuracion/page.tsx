"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSettings } from "@/lib/useStore";
import { serviceStatus } from "@/lib/storage";
import { hasBackend } from "@/lib/apiClient";

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

function Badge({ ok, text }: { ok: boolean; text?: [string, string] }) {
  const [yes = "● Configurado", no = "○ Opcional"] = text || [];
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">{yes}</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">{no}</span>
  );
}

export default function ConfiguracionPage() {
  const [settings, update] = useSettings();
  const backendOk = hasBackend();
  const llm = serviceStatus(settings, "llm");

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="mt-1 text-gray-400 text-sm">
          Lo normal es usar el servidor de voz del proyecto y no tocar nada más.
          Las claves que pegues aquí se guardan solo en este navegador y se envían
          únicamente al proveedor de IA correspondiente.
        </p>

        {/* 1. Servidor de voz */}
        <div className="mt-6 rounded-xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Servidor de voz (recomendado)</h2>
            <Badge ok={backendOk} text={["● Conectado", "○ No configurado"]} />
          </div>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Da voz y textos con IA sin claves propias (funciona en móvil incluido iPhone).
            Se configura una vez en el servidor del proyecto: ver <code className="text-gray-300">worker/README-DEPLOY.md</code>.
          </p>
          <p className="text-xs text-gray-500">
            Estado actual: {backendOk ? "conectado ✓ — todo listo." : "sin conectar — puedes seguir con clave propia o voz local (escritorio)."}
          </p>
        </div>

        {/* 2. Voz propia */}
        <div className="mt-6 rounded-xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Voz con tu propia clave (opcional)</h2>
            <Badge ok={Boolean(settings.ttsApiKey)} />
          </div>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Clave de ElevenLabs (elevenlabs.io → Profile → API Keys). Solo se usa si el
            servidor de voz no está disponible.
          </p>
          <Field
            label="Clave de ElevenLabs"
            hint="Se guarda solo en este navegador."
            value={settings.ttsApiKey}
            onChange={(v) => update({ ttsApiKey: v })}
            placeholder="el_..."
          />
        </div>

        {/* 3. Texto IA */}
        <div className="mt-6 rounded-xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Textos IA (guion y hooks) — opcional</h2>
            <Badge ok={llm.configured} />
          </div>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Recomendado: Groq (console.groq.com → API Keys, gratis).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-sm font-medium">Proveedor</span>
              <select
                value={settings.llmProvider === "openai" ? "openai" : "groq"}
                onChange={(e) => update({ llmProvider: e.target.value as "groq" | "openai" })}
                className="mt-1 w-full rounded-lg border border-white/15 bg-[#131722] px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="groq">Groq (gratis)</option>
                <option value="openai">OpenAI</option>
              </select>
              <span className="mt-1 block text-xs text-gray-400">También se usa para transcribir la voz.</span>
            </label>
            <div className="md:col-span-2">
              <Field
                label="Clave"
                hint="Ejemplo Groq: gsk_... · OpenAI: sk-..."
                value={settings.llmApiKey}
                onChange={(v) => update({ llmApiKey: v })}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 p-5 text-sm text-gray-400">
          <h2 className="font-semibold text-gray-200">Resumen</h2>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Voz: {backendOk ? "servidor del proyecto ✓" : settings.ttsApiKey ? "tu clave de ElevenLabs ✓" : "voz local en escritorio / requerirá configuración en móvil"}.</li>
            <li>Textos IA: {llm.configured ? "tu clave ✓" : backendOk ? "servidor del proyecto ✓" : "pendiente de configurar"}.</li>
            <li>Subtítulos: automáticos a partir de tu locución.</li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
