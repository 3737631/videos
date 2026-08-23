"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  runCreationPipeline,
  detectScriptLang,
  type CreationResult,
} from "@/lib/pipeline";
import { STAGE_LABELS, type StageName } from "@/lib/progress";
import { VOICE_CATALOG, getVoiceById } from "@/lib/voices/catalog";
import { listInstalled } from "@/lib/voices/engine";
import { useSettings } from "@/lib/useStore";
import { formatDuration } from "@/lib/useStore";

const STEPS: Exclude<StageName, "ERROR" | "DONE">[] = [
  "PREPARING",
  "ANALYZING_SCRIPT",
  "GENERATING_VOICE",
  "GENERATING_MUSIC",
  "CREATING_SUBTITLES",
  "MIXING_AUDIO",
  "RENDERING",
  "VERIFYING",
  "EXPORTING",
];

const ORDER_INDEX = new Map(STEPS.map((s, i) => [s, i]));

export default function CrearPage() {
  const [settings] = useSettings();
  const [script, setScript] = useState("");
  const [onlyMusic, setOnlyMusic] = useState(false);
  const [voiceId, setVoiceId] = useState(settings.ttsVoiceId);
  const [installed, setInstalled] = useState<string[]>([]);
  const [phase, setPhase] = useState<"setup" | "running" | "result">("setup");
  const [stage, setStage] = useState<StageName>("PREPARING");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreationResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem("cc-script-draft");
      if (draft) setScript(draft);
    } catch {}
    const params = new URLSearchParams(window.location.search);
    if (params.get("modo") === "musica") setOnlyMusic(true);
    listInstalled().then(setInstalled).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getVoiceById(voiceId)) {
      const byLang = VOICE_CATALOG.find(
        (v) => v.locale.startsWith(detectScriptLang(script)) && installed.includes(v.id)
      );
      setVoiceId(byLang?.id ?? settings.ttsVoiceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  const lang = useMemo(() => detectScriptLang(script), [script]);
  const nichePreview = useMemo(() => {
    return null as null | string;
  }, []);

  const start = async () => {
    setError("");
    setResult(null);
    setPhase("running");
    setStage("PREPARING");
    setPct(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await runCreationPipeline(
        { script, voiceId, onlyMusic },
        {
          signal: ctrl.signal,
          onStage: (s, _label, p) => {
            setStage(s);
            setPct(p);
          },
        }
      );
      setResult(res);
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("setup");
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const activeIdx = ORDER_INDEX.get(stage as never) ?? -1;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8">
        {phase === "setup" && (
          <div className="cc-fade-up space-y-5">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Nuevo anuncio</h1>
              <p className="mt-1 text-sm text-gray-400">
                Paso a paso, sin paneles técnicos. Tú escribes; ClipCraft hace el resto.
              </p>
            </header>

            <section className="cc-card p-5">
              <label className="text-sm font-semibold text-gray-200">1 · Tu guion</label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={6}
                placeholder="Escribe lo que dirá la voz…"
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/10"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span>Idioma detectado: <b className="text-gray-300">{lang.toUpperCase()}</b></span>
                {nichePreview}
              </div>
            </section>

            {!onlyMusic && (
              <section className="cc-card p-5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-200">2 · Voz</label>
                  <Link href="/voces" className="text-xs text-violet-300 hover:text-violet-200">
                    Ver catálogo
                  </Link>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {VOICE_CATALOG.map((v) => {
                    const ok = installed.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVoiceId(v.id)}
                        className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                          voiceId === v.id
                            ? "border-violet-400/70 bg-violet-500/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{v.flag}</span>
                          <span className="text-sm font-semibold">{v.name}</span>
                          <span className="text-xs text-gray-500">{v.gender === "femenina" ? "F" : "M"}</span>
                          {ok && (
                            <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                              Lista
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">{v.style}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                  Las voces se descargan una sola vez y quedan en tu dispositivo (sin claves ni límites).
                </p>
              </section>
            )}

            <section className="cc-card flex items-center justify-between p-5">
              <div>
                <label className="text-sm font-semibold text-gray-200">Modo solo música</label>
                <p className="text-xs text-gray-500">Vídeo con música y fondo animado, sin voz ni subtítulos.</p>
              </div>
              <button
                onClick={() => setOnlyMusic((x) => !x)}
                aria-pressed={onlyMusic}
                className={`relative h-7 w-12 rounded-full transition-colors ${onlyMusic ? "bg-violet-500" : "bg-white/15"}`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${onlyMusic ? "left-[22px]" : "left-0.5"}`}
                />
              </button>
            </section>

            {error && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              onClick={start}
              disabled={!script.trim() && !onlyMusic}
              className="cc-btn-primary w-full rounded-2xl px-6 py-4 text-base font-bold text-white"
            >
              Generar vídeo ⚡
            </button>
          </div>
        )}

        {phase === "running" && (
          <RunningView stage={stage} pct={pct} activeIdx={activeIdx} onCancel={cancel} />
        )}

        {phase === "result" && result && <ResultView result={result} onAgain={() => setPhase("setup")} />}
      </div>
    </AppShell>
  );
}

function RunningView({
  stage,
  pct,
  activeIdx,
  onCancel,
}: {
  stage: StageName;
  pct: number;
  activeIdx: number;
  onCancel: () => void;
}) {
  return (
    <div className="cc-fade-up space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{STAGE_LABELS[stage]}</h1>
        <p className="mt-1 text-sm text-gray-400">Puedes cancelar en cualquier momento.</p>
      </div>

      <div className="h-3 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(4, pct)}%`,
            background: "linear-gradient(90deg,#8B7CFF,#22D3EE)",
          }}
        />
      </div>
      <div className="text-center text-3xl font-extrabold tabular-nums">{pct}%</div>

      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const done = i < activeIdx || stage === "DONE";
          const active = s === stage;
          return (
            <li
              key={s}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                active
                  ? "border-violet-400/50 bg-violet-500/10 text-white"
                  : done
                    ? "border-emerald-400/25 bg-emerald-500/5 text-gray-300"
                    : "border-white/8 bg-white/[0.02] text-gray-500"
              }`}
            >
              <span className="w-5 text-center">{done ? "✓" : active ? <Spinner /> : "○"}</span>
              {STAGE_LABELS[s].replace("…", "")}
            </li>
          );
        })}
      </ol>

      <button onClick={onCancel} className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/5">
        Cancelar
      </button>
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent align-middle" />;
}

function ResultView({ result, onAgain }: { result: CreationResult; onAgain: () => void }) {
  return (
    <div className="cc-fade-up space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-2xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold">Tu vídeo está listo</h1>
      </div>

      <video
        src={result.url}
        controls
        playsInline
        poster={result.thumbnail || undefined}
        className="mx-auto max-h-[60vh] rounded-2xl border border-white/10 bg-black shadow-2xl"
      />

      <dl className="cc-card divide-y divide-white/6 text-sm">
        <Row k="Duración" v={formatDuration(result.duration)} />
        <Row k="Idioma / Voz" v={result.voiceId ? `${result.voiceName ?? ""} (${result.voiceId.startsWith("a") ? "EN" : result.voiceId.slice(0, 2).toUpperCase()})` : "—"} />
        <Row k="Música" v={result.musicTrackName ?? "Sin música"} />
        <Row k="Subtítulos" v={result.cuesCount > 0 ? `${result.cuesCount} tarjetas` : "Ninguno"} />
        <Row k="Estilo" v={result.niche.isDropshipping ? `Dropshipping · ${result.niche.niche}` : result.niche.niche} />
      </dl>

      {result.errors.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {result.errors.join(" · ")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <a
          href={result.url}
          download={`clipcraft-${result.projectId.slice(0, 8)}.${result.ext}`}
          className="cc-btn-primary rounded-2xl px-6 py-4 text-center text-base font-bold text-white"
        >
          Descargar vídeo
        </a>
        <button
          onClick={onAgain}
          className="rounded-2xl border border-white/15 px-6 py-4 text-base font-semibold hover:bg-white/5"
        >
          Crear otro
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-gray-400">{k}</dt>
      <dd className="font-medium text-gray-100">{v}</dd>
    </div>
  );
}
