"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ScriptPanel } from "@/components/crear/ScriptPanel";
import { VoicePanel } from "@/components/crear/VoicePanel";
import {
  runCreationPipeline,
  type CreationResult,
} from "@/lib/pipeline";
import {
  STAGE_LABELS,
  type StageName,
} from "@/lib/progress";
import {
  fetchProduct,
  parseAliUrl,
  type ProductInfo,
} from "@/lib/product/aliextract";
import {
  analyzeVideoFile,
  type VideoProbe,
} from "@/lib/media/probe";
import {
  VOICE_CATALOG,
  getVoiceById,
} from "@/lib/voices/catalog";
import {
  ensureVoiceInstalled,
  listInstalled,
} from "@/lib/voices/engine";
import {
  generateScript,
  normalizeGenLang,
} from "@/lib/script/generator";
import {
  recommendStyle,
  type VoiceStyleId,
} from "@/lib/script/styles";
import { useSettings, formatDuration } from "@/lib/useStore";

type Phase = "source" | "review" | "compose" | "running" | "result";

interface RemoteVideo {
  url: string;
  duration: number | null;
}

interface PickedSource {
  kind: "remote" | "file";
  url?: string;
  file?: File;
  duration: number;
  label: string;
}

const STEPS: Exclude<StageName, "ERROR" | "DONE">[] = [
  "PREPARING", "ANALYZING_SCRIPT", "GENERATING_VOICE", "GENERATING_MUSIC",
  "CREATING_SUBTITLES", "MIXING_AUDIO", "RENDERING", "VERIFYING", "EXPORTING",
];
const ORDER_INDEX = new Map(STEPS.map((s, i) => [s, i]));

export default function CrearPage() {
  const [settings] = useSettings();
  const [phase, setPhase] = useState<Phase>("source");
  const [error, setError] = useState("");

  // Fuente A: enlace AliExpress
  const [linkInput, setLinkInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [product, setProduct] = useState<ProductInfo | null>(null);

  // Fuente B: vídeos subidos
  const [probes, setProbes] = useState<VideoProbe[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [probingLabel, setProbingLabel] = useState("");

  // Selección de vídeo base
  const [remoteVids, setRemoteVids] = useState<RemoteVideo[]>([]);
  const [picked, setPicked] = useState<PickedSource | null>(null);

  // Guion / voz / tono
  const [script, setScript] = useState("");
  const [scriptEdited, setScriptEdited] = useState(false);
  const [voiceId, setVoiceId] = useState(settings.ttsVoiceId);
  const [styleId, setStyleId] = useState<VoiceStyleId>("viral");
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [preparingVoice, setPreparingVoice] = useState<string | null>(null);
  const [preparePct, setPreparePct] = useState<number | null>(null);
  const prepareSeq = useRef(0);

  // Pipeline
  const [stage, setStage] = useState<StageName>("PREPARING");
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState<CreationResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listInstalled().then(setInstalledIds).catch(() => {});
    const p = new URLSearchParams(window.location.search);
    const u = p.get("url");
    if (u) {
      setLinkInput(u);
      void doAnalyze(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Análisis de fuente ───────────────────────────────────────────────
  const doAnalyze = async (rawUrl: string) => {
    setError("");
    if (!parseAliUrl(rawUrl)) {
      setError("Ese enlace no parece de AliExpress. Copia la URL del producto.");
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetchProduct(rawUrl);
      setProduct(res.info);
      const vids = res.info.videoUrls.slice(0, 6).map((url) => ({ url, duration: null }));
      setRemoteVids(vids);
      setPhase("review");
      if (res.source === "none") {
        setError(
          "No se pudo leer el producto automáticamente. Puedes continuar con tus propios vídeos."
        );
      } else if (res.missing.length) {
        setError(`Falta información del producto: ${res.missing.join(", ")}. Seguimos con lo disponible.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar el enlace");
    } finally {
      setAnalyzing(false);
    }
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError("");
    const arr = Array.from(list).slice(0, 10);
    setFiles(arr);
    const out: VideoProbe[] = [];
    for (let i = 0; i < arr.length; i++) {
      setProbingLabel(`Analizando ${arr[i].name} (${i + 1}/${arr.length})…`);
      try {
        out.push(await analyzeVideoFile(arr[i]));
      } catch (e) {
        setError(e instanceof Error ? e.message : `No se pudo analizar ${arr[i].name}`);
      }
    }
    setProbingLabel("");
    setProbes(out);
    if (out.length) setPhase("review");
  };

  // Duración de un vídeo remoto vía metadatos
  const probeRemote = (url: string): Promise<number> =>
    new Promise((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      const done = (d: number) => {
        v.removeAttribute("src");
        resolve(d);
      };
      const t = setTimeout(() => done(NaN), 9000);
      v.onloadedmetadata = () => {
        clearTimeout(t);
        done(Number.isFinite(v.duration) ? v.duration : NaN);
      };
      v.onerror = () => {
        clearTimeout(t);
        done(NaN);
      };
      v.src = url;
    });

  const pickRemote = async (rv: RemoteVideo) => {
    let d = rv.duration;
    if (!d) d = await probeRemote(rv.url);
    if (!Number.isFinite(d) || d <= 0) {
      setError("No se pudo leer la duración de ese vídeo; prueba otro o sube el tuyo.");
      return;
    }
    setPicked({ kind: "remote", url: rv.url, duration: d, label: "Vídeo del producto" });
    setError("");
  };

  const pickFile = (p: VideoProbe, i: number) => {
    const f = files[i];
    if (!f) return;
    setPicked({
      kind: "file", file: f, duration: p.duration,
      label: `${p.name} · ${p.width}×${p.height}${p.fps ? ` · ${p.fps} fps` : ""}`,
    });
    setError("");
  };

  // ── Guion generado al llegar a componer ──────────────────────────────
  const ensureScript = useCallback(() => {
    if (scriptEdited && script.trim()) return;
    const voice = getVoiceById(voiceId);
    const lang = normalizeGenLang(voice?.locale ?? "es-ES");
    const gen = generateScript({
      durationSec: picked?.duration ?? 15,
      lang,
      product: product
        ? {
            title: product.title,
            price: product.price,
            currency: product.currency,
            seller: product.seller,
            features: product.features,
          }
        : undefined,
      seed: picked?.url ?? picked?.label ?? "manual",
    });
    setScript(gen.text);
    setScriptEdited(false);
  }, [scriptEdited, script, voiceId, picked, product]);

  useEffect(() => {
    if (phase === "compose") ensureScript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Puerta de voces ANTES de generar ────────────────────────────────
  useEffect(() => {
    if (phase !== "compose" && phase !== "review") return;
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
      .catch((e) => seq === prepareSeq.current && setError(e instanceof Error ? e.message : "No se pudo preparar la voz"))
      .finally(() => {
        if (seq === prepareSeq.current) setPreparingVoice(null);
      });
  }, [voiceId, installedIds, phase]);

  const voice = getVoiceById(voiceId);
  const genLang = normalizeGenLang(voice?.locale ?? "es-ES");
  const recommended = recommendStyle({
    scriptText: script,
    isDropshipping: true,
    durationSec: picked?.duration ?? null,
  });

  // ── Generar ──────────────────────────────────────────────────────────
  const start = async () => {
    if (!script.trim() || !picked) return;
    setError("");
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);
    setPhase("running");
    setStage("PREPARING");
    setPct(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await runCreationPipeline(
        {
          script,
          voiceId,
          styleId,
          targetDurationSec: picked.duration,
        },
        {
          signal: ctrl.signal,
          onStage: (s, _l, p) => {
            setStage(s);
            setPct(p);
          },
        }
      );
      setResult(res);
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("compose");
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();
  const activeIdx = ORDER_INDEX.get(stage as never) ?? -1;
  const canGenerate =
    !!script.trim() && !!picked && installedIds.includes(voiceId) && !preparingVoice;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8 pb-24">
        {phase === "source" && (
          <div className="cc-fade-up space-y-5">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Crear anuncio</h1>
              <p className="mt-1 text-sm text-gray-400">
                Empieza desde un producto de AliExpress o sube tus propios vídeos.
              </p>
            </header>

            {/* A · Enlace */}
            <section className="cc-card p-5">
              <label className="text-sm font-semibold text-gray-200">🔗 Enlace de AliExpress</label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !analyzing && doAnalyze(linkInput)}
                  placeholder="Pega aquí el enlace…"
                  inputMode="url"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/10"
                />
                <button
                  onClick={() => doAnalyze(linkInput)}
                  disabled={analyzing}
                  className="cc-btn-primary rounded-xl px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {analyzing ? "Analizando…" : "Analizar"}
                </button>
              </div>
            </section>

            <div className="flex items-center gap-3 text-xs text-gray-600">
              <span className="h-px flex-1 bg-white/10" /> O <span className="h-px flex-1 bg-white/10" />
            </div>

            {/* B · Subir vídeos */}
            <section className="cc-card p-5">
              <label className="text-sm font-semibold text-gray-200">🎥 Subir vídeos</label>
              <p className="mt-1 text-xs text-gray-500">
                Se analizan en tu dispositivo: duración, resolución y orientación. Nada se envía a ningún servidor.
              </p>
              <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-white/20 bg-black/20 px-4 py-8 text-center transition-colors hover:border-violet-400/50">
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void onFiles(e.target.files)}
                />
                {probingLabel ? (
                  <span className="text-sm text-violet-300">{probingLabel}</span>
                ) : (
                  <>
                    <span className="block text-sm font-semibold text-gray-200">
                      Seleccionar vídeos
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">MP4 · MOV · WebM</span>
                  </>
                )}
              </label>
              {files.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-gray-400">
                  {files.map((f, i) => (
                    <li key={i} className="truncate">
                      • {f.name} ({probes[i] ? `${probes[i].duration.toFixed(1)} s` : "…"})
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {error && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        )}

        {phase === "review" && (
          <div className="cc-fade-up space-y-5">
            <header className="flex items-center justify-between">
              <h1 className="text-xl font-bold tracking-tight">Elige el vídeo base</h1>
              <button onClick={() => setPhase("source")} className="text-xs text-gray-400 hover:text-white">
                ← Volver
              </button>
            </header>

            {product && (
              <section className="cc-card p-5">
                <div className="flex items-center gap-2 text-xs text-violet-300">
                  🛒 Producto analizado
                </div>
                {product.title && (
                  <h2 className="mt-2 line-clamp-2 text-sm font-semibold text-gray-100">
                    {product.title}
                  </h2>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                  {product.price && (
                    <span>
                      Precio:{" "}
                      <b className="text-emerald-300">
                        {product.currency === "EUR" ? `${product.price} €` : `$${product.price}`}
                      </b>
                    </span>
                  )}
                  {product.seller && <span>Vendedor: {product.seller}</span>}
                  {!product.title && <span>Nombre no disponible</span>}
                </div>
                {product.features.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-gray-500">
                    {product.features.slice(0, 4).map((f, i) => (
                      <li key={i}>• {f}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {remoteVids.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-300">Vídeos encontrados</h2>
                {remoteVids.map((rv, i) => {
                  const active = picked?.kind === "remote" && picked.url === rv.url;
                  return (
                    <button
                      key={i}
                      onClick={() => void pickRemote(rv)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${
                        active ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <video
                        src={rv.url}
                        muted
                        preload="metadata"
                        className="h-14 w-10 rounded-lg bg-black object-cover"
                        onLoadedMetadata={(e) => {
                          const d = e.currentTarget.duration;
                          if (Number.isFinite(d)) {
                            setRemoteVids((old) =>
                              old.map((x, j) => (j === i ? { ...x, duration: d } : x))
                            );
                          }
                        }}
                      />
                      <span className="text-sm text-gray-200">Vídeo {i + 1}</span>
                      {rv.duration && (
                        <span className="ml-auto text-xs text-gray-500">{rv.duration.toFixed(1)} s</span>
                      )}
                      {active && <span className="ml-auto text-xs text-violet-300">Elegido ✓</span>}
                    </button>
                  );
                })}
              </section>
            )}

            {probes.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-300">Tus vídeos</h2>
                {probes.map((p, i) => {
                  const active = picked?.kind === "file" && files[i] === picked.file;
                  return (
                    <button
                      key={i}
                      onClick={() => pickFile(p, i)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${
                        active ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <span className="text-lg">🎥</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{p.name}</span>
                      <span className="text-xs text-gray-500">
                        {p.duration.toFixed(1)} s · {p.orientation}
                      </span>
                    </button>
                  );
                })}
              </section>
            )}

            {error && (
              <div className="rounded-xl border border-sky-400/25 bg-sky-500/10 px-4 py-3 text-xs text-sky-200">
                {error}
              </div>
            )}

            <button
              onClick={() => setPhase("compose")}
              disabled={!picked}
              className="cc-btn-primary w-full rounded-2xl px-6 py-4 text-base font-bold text-white disabled:opacity-40"
            >
              Continuar →
            </button>
          </div>
        )}

        {phase === "compose" && (
          <div className="cc-fade-up space-y-5">
            <header className="flex items-center justify-between">
              <h1 className="text-xl font-bold tracking-tight">Prepara tu anuncio</h1>
              <button onClick={() => setPhase("review")} className="text-xs text-gray-400 hover:text-white">
                ← Cambiar vídeo
              </button>
            </header>

            <div className="cc-card flex items-center justify-between p-4 text-xs text-gray-300">
              <span className="min-w-0 truncate">{picked?.label}</span>
              <span className="ml-3 shrink-0 font-semibold text-violet-300">
                ⏱ {picked ? formatDuration(picked.duration) : "—"}
              </span>
            </div>

            <ScriptPanel
              script={script}
              onChange={(t) => {
                setScript(t);
                setScriptEdited(true);
              }}
              targetSec={picked?.duration ?? null}
              lang={genLang}
              styleId={styleId}
            />

            <VoicePanel
              voiceId={voiceId}
              onVoice={setVoiceId}
              styleId={styleId}
              onStyle={setStyleId}
              recommended={recommended}
              lang={genLang}
              installedIds={installedIds}
              preparingVoice={preparingVoice}
              preparePct={preparePct}
              scriptText={script}
            />

            <section className="cc-card flex items-center gap-3 p-4">
              <span>🎵</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-200">Música automática</p>
                <p className="text-[11px] text-gray-500">
                  Elegida según el guion, el tono y la duración. Cambia en cada versión.
                </p>
              </div>
              <Link href="/musica" className="text-xs text-violet-300 hover:text-violet-200">
                Escuchar
              </Link>
            </section>

            {error && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              onClick={start}
              disabled={!canGenerate}
              className="cc-btn-primary w-full rounded-2xl px-6 py-4 text-base font-bold text-white disabled:opacity-40"
            >
              🎬 Generar anuncio
            </button>
            {!canGenerate && !preparingVoice && (
              <p className="-mt-2 text-center text-xs text-gray-500">
                {script.trim() ? "Esperando voces…" : "Escribe o genera el guion primero."}
              </p>
            )}
          </div>
        )}

        {phase === "running" && (
          <RunningView stage={stage} pct={pct} activeIdx={activeIdx} onCancel={cancel} />
        )}

        {phase === "result" && result && (
          <ResultView
            result={result}
            onAnotherVersion={start}
            onEditScript={() => setPhase("compose")}
            onNewSource={() => {
              URL.revokeObjectURL(result.url);
              setResult(null);
              setPicked(null);
              setPhase("source");
            }}
          />
        )}
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
          style={{ width: `${Math.max(4, pct)}%`, background: "linear-gradient(90deg,#8B7CFF,#22D3EE)" }}
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
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent align-middle" />
  );
}

function ResultView({
  result,
  onAnotherVersion,
  onEditScript,
  onNewSource,
}: {
  result: CreationResult;
  onAnotherVersion: () => void;
  onEditScript: () => void;
  onNewSource: () => void;
}) {
  return (
    <div className="cc-fade-up space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-2xl">✓</div>
        <h1 className="text-2xl font-bold">Tu anuncio está listo</h1>
      </div>

      <video
        src={result.url}
        controls
        autoPlay
        playsInline
        poster={result.thumbnail || undefined}
        className="mx-auto max-h-[58vh] rounded-2xl border border-white/10 bg-black shadow-2xl"
      />

      <dl className="cc-card divide-y divide-white/6 text-sm">
        <Row k="Duración" v={`${formatDuration(result.duration)}${result.targetSeconds ? ` (objetivo ${result.targetSeconds.toFixed(1)} s)` : ""}`} />
        <Row k="Voz" v={result.voiceName ?? "—"} />
        <Row k="Tono" v={result.styleId ?? "—"} />
        <Row k="Música" v={result.musicTrackName ?? "Sin música"} />
        <Row k="Subtítulos" v={result.cuesCount > 0 ? `${result.cuesCount} tarjetas` : "Ninguno"} />
      </dl>

      {result.errors.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {result.errors.join(" · ")}
        </div>
      )}

      <a
        href={result.url}
        download={`clipcraft-${result.projectId.slice(0, 8)}.${result.ext}`}
        className="cc-btn-primary block w-full rounded-2xl px-6 py-4 text-center text-base font-bold text-white"
      >
        ⬇ Descargar
      </a>

      <div className="grid grid-cols-2 gap-3">
        <ActionBtn onClick={onAnotherVersion}>🔄 Otra versión</ActionBtn>
        <ActionBtn onClick={onEditScript}>✏️ Editar guion</ActionBtn>
        <ActionBtn onClick={onEditScript}>🎙 Cambiar voz</ActionBtn>
        <ActionBtn onClick={onNewSource}>🎥 Otro vídeo</ActionBtn>
      </div>
    </div>
  );
}

function ActionBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-gray-200 hover:bg-white/5"
    >
      {children}
    </button>
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

