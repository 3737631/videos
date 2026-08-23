"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ScriptPanel } from "@/components/crear/ScriptPanel";
import { VoicePanel } from "@/components/crear/VoicePanel";
import { runCreationPipeline, type CreationResult } from "@/lib/pipeline";
import { STAGE_LABELS, type StageName } from "@/lib/progress";
import { analyzeVideoFile, type VideoProbe } from "@/lib/media/probe";
import { fetchProduct, parseAliUrl, type ProductInfo } from "@/lib/product/aliextract";
import { VOICE_CATALOG, getVoiceById, defaultVoiceForLocale } from "@/lib/voices/catalog";
import { ensureVoiceInstalled, listInstalled } from "@/lib/voices/engine";
import { generateScript, normalizeGenLang } from "@/lib/script/generator";
import { recommendStyle, type VoiceStyleId } from "@/lib/script/styles";
import { useSettings, useProjectActions, formatDuration } from "@/lib/useStore";
import { defaultSubtitleStyle } from "@/lib/editplan";

type Step = 1 | 2 | 3;
type Mode = "voice" | "music";

const STEPS: Exclude<StageName, "ERROR" | "DONE">[] = [
  "PREPARING", "ANALYZING_SCRIPT", "GENERATING_VOICE", "GENERATING_MUSIC",
  "CREATING_SUBTITLES", "MIXING_AUDIO", "RENDERING", "VERIFYING", "EXPORTING",
];
const ORDER_INDEX = new Map(STEPS.map((s, i) => [s, i]));

export default function CrearPage() {
  const [settings] = useSettings();
  const [projects, saveProject] = useProjectActionsSafe();

  // Paso 1
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [mode, setMode] = useState<Mode>("voice");

  // Paso 2
  const [link, setLink] = useState("");
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [analizing, setAnalizing] = useState(false);
  const [script, setScript] = useState("");
  const [scriptEdited, setScriptEdited] = useState(false);
  const [voiceId, setVoiceId] = useState(settings.ttsVoiceId);
  const [styleId, setStyleId] = useState<VoiceStyleId>("viral");
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [preparingVoice, setPreparingVoice] = useState<string | null>(null);
  const [preparePct, setPreparePct] = useState<number | null>(null);
  const prepareSeq = useRef(0);

  // Generación
  const [stage, setStage] = useState<StageName>("PREPARING");
  const [pct, setPct] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [phase, setPhase] = useState<"setup" | "running" | "result">("setup");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreationResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listInstalled().then(setInstalledIds).catch(() => {});
  }, []);

  // ── Subir vídeo ────────────────────────────────────────────────────────
  const onFile = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    setError("");
    setFile(f);
    setProbing(true);
    try {
      const p = await analyzeVideoFile(f, { timeoutMs: 15000 });
      setProbe(p);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el vídeo");
    } finally {
      setProbing(false);
    }
  };

  // ── Enlace AliExpress (solo modo voz) ──────────────────────────────────
  const loadProduct = async () => {
    if (!parseAliUrl(link)) {
      setError("Pega un enlace válido de AliExpress (o deja el campo vacío para voz genérica).");
      return;
    }
    setAnalizing(true);
    setError("");
    try {
      const res = await fetchProduct(link);
      setProduct(res.info);
      if (res.source === "none") {
        setError("No se pudo leer el producto; se usará voz y guion genéricos.");
      }
    } catch (e) {
      setError("No se pudo leer el producto; seguimos con voz genérica.");
    } finally {
      setAnalizing(false);
    }
  };

  // Guion auto al entrar al detalle
  const ensureScript = () => {
    if (scriptEdited && script.trim()) return;
    const gen = generateScript({
      durationSec: probe?.duration ?? 15,
      lang: "es",
      product: product
        ? { title: product.title, price: product.price, currency: product.currency, seller: product.seller, features: product.features }
        : undefined,
      seed: product?.itemId ?? file?.name ?? "manual",
    });
    setScript(gen.text);
    setScriptEdited(false);
  };

  useEffect(() => {
    if (step === 2 && mode === "voice") ensureScript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, product]);

  // Voz recomendada automática por idioma
  const autoVoice = defaultVoiceForLocale("es-ES");
  useEffect(() => {
    if (mode === "voice" && !installedIds.includes(voiceId)) {
      setVoiceId(autoVoice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Puerta de voces antes de generar
  useEffect(() => {
    if (mode !== "voice") return;
    if (installedIds.includes(voiceId)) {
      setPreparingVoice(null);
      return;
    }
    const seq = ++prepareSeq.current;
    setPreparingVoice(voiceId);
    setPreparePct(null);
    ensureVoiceInstalled(voiceId, {
      onProgress: (p) => seq === prepareSeq.current && setPreparePct(p),
    })
      .then(() => listInstalled().then(setInstalledIds))
      .catch((e) =>
        seq === prepareSeq.current && setError(e instanceof Error ? e.message : "No se pudo preparar la voz")
      )
      .finally(() => seq === prepareSeq.current && setPreparingVoice(null));
  }, [voiceId, installedIds, mode]);

  const recommended = recommendStyle({ scriptText: script, isDropshipping: true, durationSec: probe?.duration ?? null });

  // ── Generar ────────────────────────────────────────────────────────────
  const start = async () => {
    if (!file || !probe) return;
    setError("");
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);
    setPhase("running");
    setStage("PREPARING");
    setPct(0);
    setEta(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await runCreationPipeline(
        {
          script: mode === "voice" ? script : "",
          voiceId: mode === "voice" ? voiceId : null,
          onlyMusic: mode === "music",
          styleId: mode === "voice" ? styleId : undefined,
          targetDurationSec: probe.duration,
        },
        {
          signal: ctrl.signal,
          onStage: (s, _l, p, etaSec) => {
            setStage(s);
            setPct(p);
            setEta(etaSec ?? null);
          },
        }
      );
      setResult(res);
      setPhase("result");
      try {
        saveProject({
          id: crypto.randomUUID(),
          name: product?.title || `Anuncio ${mode === "music" ? "con música" : "con voz"}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: "ready",
          sources: [],
          metadata: {
            scenes: [], duration: probe.duration, resolution: { width: probe.width, height: probe.height },
            fps: probe.fps ?? 30, people: 0, objects: [], speech: 0, silenceSegments: [],
            sceneChanges: 0, interestingSegments: [], audioLevel: 0, qualityScore: 0, analysisText: "",
          },
          style: "anuncio", goal: "ventas", targetDuration: "auto",
          hooks: [], selectedHook: "", script: [], voice: null, subtitles: { cues: [], style: defaultSubtitleStyle() },
          music: null, editPlan: null, renders: [],
          thumbnail: res.thumbnail, renderUrl: res.url, renderValidation: undefined,
          removeWatermark: true,
        });
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("setup");
    } finally {
      abortRef.current = null;
    }
  };

  const canGenerate =
    !!file && !!probe && (mode === "music" || (script.trim() && installedIds.includes(voiceId) && !preparingVoice));

  return (
    <AppShell>
      <div className="mx-auto max-w-xl px-5 py-8 pb-24">
        {phase === "setup" && (
          <div className="cc-fade-up space-y-5">
            {/* Stepper minimal */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    step >= s ? "bg-violet-500 text-white" : "bg-white/10 text-gray-400"
                  }`}
                >
                  {s}
                </span>
              ))}
              <span className="ml-1">Vídeo · Detalles · Crear</span>
            </div>

            {step === 1 && (
              <section className="cc-card p-6 text-center">
                <h1 className="text-xl font-bold">Crea tu anuncio</h1>
                <p className="mt-1 text-sm text-gray-400">Sube tu vídeo. Todo se hace en tu dispositivo.</p>

                <label className="mt-5 block cursor-pointer rounded-2xl border border-dashed border-white/25 bg-black/20 px-4 py-10 transition-colors hover:border-violet-400/50">
                  <input type="file" accept="video/*" className="hidden" onChange={(e) => void onFile(e.target.files)} />
                  {probing ? (
                    <span className="text-sm text-violet-300">Analizando vídeo…</span>
                  ) : (
                    <>
                      <span className="block text-4xl">🎥</span>
                      <span className="mt-2 block text-sm font-semibold text-gray-200">Toca para subir vídeo</span>
                      <span className="mt-1 block text-xs text-gray-500">MP4 · MOV · WebM</span>
                    </>
                  )}
                </label>

                {probe && (
                  <div className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-left text-sm text-gray-200">
                    ✓ {file?.name} · {probe.duration.toFixed(1)} s · {probe.orientation}
                  </div>
                )}

                <div className="mt-5">
                  <p className="mb-2 text-sm font-semibold text-gray-200">¿Qué quieres en el anuncio?</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setMode("voice")}
                      className={`rounded-xl border px-3 py-4 text-left ${
                        mode === "voice" ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <div className="text-lg">🎙️</div>
                      <div className="mt-1 text-sm font-semibold text-white">Voz + subtítulos</div>
                      <div className="text-[11px] text-gray-500">Lee el guion del producto</div>
                    </button>
                    <button
                      onClick={() => setMode("music")}
                      className={`rounded-xl border px-3 py-4 text-left ${
                        mode === "music" ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <div className="text-lg">🎵</div>
                      <div className="mt-1 text-sm font-semibold text-white">Solo música</div>
                      <div className="text-[11px] text-gray-500">Rápido, sin voz</div>
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setStep(2)}
                  disabled={!probe}
                  className="cc-btn-primary mt-5 w-full rounded-2xl px-6 py-4 text-base font-bold text-white disabled:opacity-40"
                >
                  Continuar
                </button>
              </section>
            )}

            {step === 2 && (
              <div className="space-y-4">
                {mode === "voice" && (
                  <>
                    <section className="cc-card p-5">
                      <label className="text-sm font-semibold text-gray-200">
                        Enlace de AliExpress <span className="text-gray-500">(opcional)</span>
                      </label>
                      <p className="mt-1 text-[11px] text-gray-500">
                        Lo analizamos para el guion. Si lo dejas vacío usamos una voz genérica.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && loadProduct()}
                          placeholder="https://es.aliexpress.com/item/…"
                          inputMode="url"
                          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60"
                        />
                        <button onClick={loadProduct} disabled={analizing} className="rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/5">
                          {analizing ? "…" : "Usar"}
                        </button>
                      </div>
                      {product?.title && (
                        <div className="mt-3 rounded-xl bg-white/5 px-4 py-3 text-sm">
                          <div className="font-semibold text-gray-100">🛒 {product.title}</div>
                          <div className="mt-1 text-xs text-gray-400">
                            {product.price && (
                              <span className="text-emerald-300">
                                {product.currency === "EUR" ? `${product.price} €` : `$${product.price}`} ·{" "}
                              </span>
                            )}
                            Voz: <b className="text-gray-200">{getVoiceById(autoVoice)?.name}</b> (se elige sola)
                          </div>
                        </div>
                      )}
                    </section>

                    <ScriptPanel
                      script={script}
                      onChange={(t) => {
                        setScript(t);
                        setScriptEdited(true);
                      }}
                      targetSec={probe?.duration ?? null}
                      lang={normalizeGenLang(getVoiceById(voiceId)?.locale ?? "es-ES")}
                      styleId={styleId}
                    />

                    <VoicePanel
                      voiceId={voiceId}
                      onVoice={setVoiceId}
                      styleId={styleId}
                      onStyle={setStyleId}
                      recommended={recommended}
                      lang={normalizeGenLang(getVoiceById(voiceId)?.locale ?? "es-ES")}
                      installedIds={installedIds}
                      preparingVoice={preparingVoice}
                      preparePct={preparePct}
                      scriptText={script}
                    />
                  </>
                )}

                {mode === "music" && (
                  <section className="cc-card p-5 text-sm text-gray-300">
                    🎵 Música automática seleccionada según la duración del vídeo. Sin voz ni subtítulos.
                  </section>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="rounded-2xl border border-white/15 px-5 py-4 text-sm hover:bg-white/5">
                    ← Atrás
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={mode === "voice" && !script.trim()}
                    className="cc-btn-primary flex-1 rounded-2xl px-6 py-4 text-base font-bold text-white disabled:opacity-40"
                  >
                    Revisar
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <section className="cc-card space-y-3 p-5">
                <h1 className="text-xl font-bold">Listo para crear</h1>
                <ul className="space-y-1.5 text-sm text-gray-300">
                  <li>🎥 Vídeo: {probe?.duration.toFixed(1)} s ({mode === "voice" ? "voz + subtítulos" : "solo música"})</li>
                  {mode === "voice" && (
                    <>
                      <li>🎙️ Voz: {getVoiceById(voiceId)?.name} · tono {recommended}</li>
                      <li>✍️ Guion: {script.split(/\s+/).filter(Boolean).length} palabras</li>
                    </>
                  )}
                </ul>

                {error && (
                  <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setStep(2)} className="rounded-2xl border border-white/15 px-5 py-4 text-sm hover:bg-white/5">
                    ← Atrás
                  </button>
                  <button
                    onClick={start}
                    disabled={!canGenerate}
                    className="cc-btn-primary flex-1 rounded-2xl px-6 py-4 text-base font-bold text-white disabled:opacity-40"
                  >
                    🎬 Crear anuncio
                  </button>
                </div>
                {!canGenerate && mode === "voice" && (
                  <p className="-mt-1 text-center text-xs text-gray-500">
                    {preparingVoice ? "Preparando voces…" : "Falta preparar la voz"}
                  </p>
                )}
              </section>
            )}

            {error && step !== 2 && step !== 3 && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        )}

        {phase === "running" && (
          <div className="cc-fade-up space-y-6 py-10">
            <div className="text-center">
              <h1 className="text-2xl font-bold">{STAGE_LABELS[stage]}</h1>
              {eta != null && <p className="mt-1 text-sm text-gray-400">Quedan ~{eta} s · {pct}%</p>}
              <p className="mt-1 text-sm text-gray-400">Puedes cancelar en cualquier momento.</p>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(4, pct)}%`, background: "linear-gradient(90deg,#8B7CFF,#22D3EE)" }} />
            </div>
            <div className="text-center text-3xl font-extrabold tabular-nums">{pct}%</div>
            <ol className="space-y-2">
              {STEPS.map((s, i) => {
                const done = i < (ORDER_INDEX.get(stage as never) ?? -1) || stage === "DONE";
                const active = s === stage;
                return (
                  <li key={s} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${active ? "border-violet-400/50 bg-violet-500/10 text-white" : done ? "border-emerald-400/25 bg-emerald-500/5 text-gray-300" : "border-white/8 bg-white/[0.02] text-gray-500"}`}>
                    <span className="w-5 text-center">{done ? "✓" : active ? <Spinner /> : "○"}</span>
                    {STAGE_LABELS[s].replace("…", "")}
                  </li>
                );
              })}
            </ol>
            <button onClick={() => abortRef.current?.abort()} className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/5">
              Cancelar
            </button>
          </div>
        )}

        {phase === "result" && result && (
          <div className="cc-fade-up space-y-5">
            <div className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-2xl">✓</div>
              <h1 className="text-2xl font-bold">Tu anuncio está listo</h1>
            </div>
            <video src={result.url} controls autoPlay playsInline poster={result.thumbnail || undefined} className="mx-auto max-h-[58vh] rounded-2xl border border-white/10 bg-black shadow-2xl" />
            <dl className="cc-card divide-y divide-white/6 text-sm">
              <Row k="Duración" v={`${formatDuration(result.duration)}${result.targetSeconds ? ` (obj ${result.targetSeconds.toFixed(1)} s)` : ""}`} />
              {result.voiceName && <Row k="Voz" v={result.voiceName} />}
              <Row k="Música" v={result.musicTrackName ?? "Sin música"} />
              <Row k="Subtítulos" v={result.cuesCount > 0 ? `${result.cuesCount} tarjetas` : "Ninguno"} />
            </dl>
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                {result.errors.join(" · ")}
              </div>
            )}
            <a href={result.url} download={`clipcraft-${result.projectId.slice(0, 8)}.${result.ext}`} className="cc-btn-primary block w-full rounded-2xl px-6 py-4 text-center text-base font-bold text-white">
              ⬇ Descargar
            </a>
            <button onClick={() => { if (result.url) URL.revokeObjectURL(result.url); setResult(null); setPhase("setup"); setStep(1); setFile(null); setProbe(null); setScript(""); }} className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-medium hover:bg-white/5">
              🔄 Crear otro
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function useProjectActionsSafe() {
  const { projects, saveProject } = useProjectActions();
  return [projects, saveProject] as const;
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent align-middle" />;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-gray-400">{k}</dt>
      <dd className="font-medium text-gray-100">{v}</dd>
    </div>
  );
}
