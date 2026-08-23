"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { VOICE_CATALOG } from "@/lib/voices/catalog";
import { synthesizeProsody, isVoiceInstalled } from "@/lib/voices/engine";
import { VOICE_STYLES, getStyle, type VoiceStyleId } from "@/lib/script/styles";
import { samplePhrase } from "./ScriptPanel";

interface Props {
  voiceId: string;
  onVoice: (id: string) => void;
  styleId: VoiceStyleId | null;
  onStyle: (id: VoiceStyleId) => void;
  recommended: VoiceStyleId;
  lang: string;
  installedIds: string[];
  /** Instalación en curso (puerta antes de generar) */
  preparingVoice: string | null;
  preparePct: number | null;
  scriptText: string;
}

/**
 * VOZ + TONO — previews con el MISMO motor TTS real del vídeo.
 * Estilos = velocidad por rol + pausas (lo que los motores soportan de verdad).
 */
export function VoicePanel({
  voiceId,
  onVoice,
  styleId,
  onStyle,
  recommended,
  lang,
  installedIds,
  preparingVoice,
  preparePct,
  scriptText,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [busyPreview, setBusyPreview] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState("");

  const playBlob = (blob: Blob) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = urlRef.current;
    void audioRef.current.play().catch(() => {});
  };

  const previewScript = async () => {
    setPreviewErr("");
    setBusyPreview("script");
    try {
      const firstLine =
        scriptText.split(/(?<=[.!?…])\s+/)[0]?.slice(0, 160) || samplePhrase(lang);
      const r = await synthesizeProsody(firstLine, voiceId, {
        styleId: styleId ?? undefined,
      });
      playBlob(r.blob);
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : "No se pudo previsualizar");
    } finally {
      setBusyPreview(null);
    }
  };

  const previewStyle = async (sid: VoiceStyleId) => {
    setPreviewErr("");
    setBusyPreview(sid);
    try {
      const r = await synthesizeProsody(samplePhrase(lang), voiceId, { styleId: sid });
      playBlob(r.blob);
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : "No se pudo previsualizar");
    } finally {
      setBusyPreview(null);
    }
  };

  return (
    <section className="cc-card p-5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-gray-200">Voz y tono</label>
        <Link href="/voces" className="text-xs text-violet-300 hover:text-violet-200">
          Gestionar voces
        </Link>
      </div>

      {/* Selector compacto de voces */}
      <select
        value={voiceId}
        onChange={(e) => onVoice(e.target.value)}
        className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-violet-400/60"
      >
        {VOICE_CATALOG.map((v) => (
          <option key={v.id} value={v.id}>
            {v.flag} {v.name} · {v.locale}
            {installedIds.includes(v.id) ? " · ✓ instalada" : ""}
          </option>
        ))}
      </select>

      {/* Puerta de preparación ANTES de generar */}
      {preparingVoice && (
        <div className="mt-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
          Preparando voces…{" "}
          {preparePct != null ? `${preparePct}%` : "descargando"}
          {preparePct != null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-violet-400 transition-all"
                style={{ width: `${Math.max(4, preparePct)}%` }}
              />
            </div>
          )}
        </div>
      )}
      {!preparingVoice && installedIds.includes(voiceId) && (
        <div className="mt-2 text-xs font-medium text-emerald-300">🟢 Voces listas</div>
      )}

      <button
        onClick={previewScript}
        disabled={busyPreview !== null || !installedIds.includes(voiceId)}
        className="mt-3 w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold hover:bg-white/5 disabled:opacity-50"
      >
        {busyPreview === "script" ? "Generando muestra…" : "🎤 Previsualizar voz"}
      </button>

      {/* Estilos */}
      <div className="mt-4">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          Estilo
          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-200">
            ✨ Recomendado: {getStyle(recommended).label}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {VOICE_STYLES.map((s) => {
            const active = styleId === s.id;
            return (
              <div
                key={s.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                  active
                    ? "border-violet-400/70 bg-violet-500/10"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <button onClick={() => onStyle(s.id)} className="min-w-0 flex-1 text-left">
                  <span className={`text-sm ${active ? "font-bold text-white" : "text-gray-300"}`}>
                    {active ? "● " : "○ "}
                    {s.label}
                  </span>
                  <span className="block truncate text-[11px] text-gray-500">{s.desc}</span>
                </button>
                <button
                  onClick={() => previewStyle(s.id)}
                  disabled={busyPreview !== null || !installedIds.includes(voiceId)}
                  title={`Escuchar ejemplo (${s.label})`}
                  className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40"
                >
                  {busyPreview === s.id ? "…" : "▶"}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-600">
          Los estilos ajustan velocidad y pausas reales de la voz seleccionada.
        </p>
      </div>

      {previewErr && (
        <div className="mt-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {previewErr}
        </div>
      )}

      {/* audio element implícito: reproducimos con new Audio() */}
    </section>
  );
}
