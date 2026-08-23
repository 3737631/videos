"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeVideoFile } from "@/lib/media/probe";
import { fetchProduct, parseAliUrl, type ProductInfo } from "@/lib/product/aliextract";
import { generateScript } from "@/lib/script/generator";
import { defaultVoiceForLocale, getVoiceById, VOICE_CATALOG } from "@/lib/voices/catalog";
import { ensureVoiceInstalled, isVoiceInstalled } from "@/lib/voices/engine";
import { recommendStyle, VOICE_STYLES, type VoiceStyleId } from "@/lib/script/styles";
import { runCreationPipeline } from "@/lib/pipeline";
import { saveClip } from "@/lib/clips";
import { pickTargetDuration } from "@/lib/video/highlights";
import { VoicePanel } from "@/components/crear/VoicePanel";
import { ScriptPanel } from "@/components/crear/ScriptPanel";
import { AppShell } from "@/components/AppShell";

type Mode = "voice" | "music";
type Step = 1 | 2 | 3;
type Phase = "setup" | "running" | "done" | "error";

const MUSIC_CHOICES: Array<{ label: string; cat: string | null }> = [
  { label: "Automatica", cat: null },
  { label: "Viral", cat: "viral" },
  { label: "Estilo de vida", cat: "lifestyle" },
  { label: "Romantica", cat: "romantic" },
  { label: "Misteriosa", cat: "mysterious" },
  { label: "Motivadora", cat: "motivational" },
  { label: "Relajante", cat: "relaxing" },
  { label: "Dramatica", cat: "dramatic" },
  { label: "Historia", cat: "storytelling" },
];

export default function CrearPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [mode, setMode] = useState<Mode>("voice");

  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [productNote, setProductNote] = useState("");
  const [manualName, setManualName] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);

  const [voiceId, setVoiceId] = useState<string>(defaultVoiceForLocale("es-XX"));
  const [styleId, setStyleId] = useState<VoiceStyleId | null>(null);
  const [script, setScript] = useState("");
  const [lang, setLang] = useState("es");

  const [musicCat, setMusicCat] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("setup");
  const [stageLabel, setStageLabel] = useState("");
  const [pct, setPct] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [result, setResult] = useState<null | Awaited<ReturnType<typeof runCreationPipeline>>>(null);
  const [errMsg, setErrMsg] = useState("");

  const [preparingVoice, setPreparingVoice] = useState<string | null>(null);
  const [preparePct, setPreparePct] = useState<number | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [recommended, setRecommended] = useState<VoiceStyleId>(VOICE_STYLES[0].id);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const thumbUrlRef = useRef<string | null>(null);

  // Refresca la lista de voces instaladas
  useEffect(() => {
    setInstalledIds(VOICE_CATALOG.filter((v) => isVoiceInstalled(v.id)).map((v) => v.id));
  }, []);

  // Prepara la voz en segundo plano (modo voz)
  useEffect(() => {
    if (mode !== "voice" || !file) return;
    let alive = true;
    const ctrl = new AbortController();
    setPreparingVoice(voiceId);
    setPreparePct(0);
    ensureVoiceInstalled(voiceId, {
      signal: ctrl.signal,
      onProgress: (p) => {
        if (alive) setPreparePct(Math.round((p ?? 0) * 100));
      },
    })
      .then(() => {
        if (!alive) return;
        setInstalledIds(VOICE_CATALOG.filter((v) => isVoiceInstalled(v.id)).map((v) => v.id));
        setPreparingVoice(null);
        setPreparePct(null);
      })
      .catch(() => {
        if (alive) {
          setPreparingVoice(null);
          setPreparePct(null);
        }
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [mode, voiceId, file]);

  const onPickFile = useCallback(async (f: File) => {
    setFile(f);
    setStep(1);
    try {
      const probe = await analyzeVideoFile(f, { timeoutMs: 20000 });
      setVideoDuration(probe.duration || 0);
      const t = document.createElement("video");
      const u = URL.createObjectURL(f);
      thumbUrlRef.current = u;
      t.src = u;
      t.muted = true;
      t.onloadeddata = () => {
        const cv = document.createElement("canvas");
        cv.width = 240;
        cv.height = Math.round((240 * t.videoHeight) / t.videoWidth) || 420;
        cv.getContext("2d")?.drawImage(t, 0, 0, cv.width, cv.height);
        try {
          setThumb(cv.toDataURL("image/jpeg", 0.7));
        } catch {}
      };
    } catch {
      setVideoDuration(0);
    }
  }, []);

  const loadProduct = useCallback(async () => {
    const raw = url.trim();
    if (!parseAliUrl(raw)) {
      setProductNote("Pega un enlace valido de AliExpress.");
      return;
    }
    setLoadingProduct(true);
    setProductNote("");
    try {
      const res = await fetchProduct(raw, { timeoutMs: 20000 });
      setProduct(res.info);
      if (res.source === "none") {
        setProductNote("No se pudo leer el producto automaticamente. Escribe su nombre abajo.");
      } else if (!res.info.title) {
        setProductNote("Falta el nombre del producto. Escribelo abajo.");
      }
      setManualName(res.info.title ?? "");
    } catch {
      setProduct(null);
      setProductNote("No se pudo leer el producto. Escribe su nombre abajo.");
    } finally {
      setLoadingProduct(false);
    }
  }, [url]);

  const productTitle = manualName.trim() || product?.title || null;

  const goStep2 = useCallback(() => {
    setStep(2);
    if (mode === "voice") {
      setRecommended(recommendStyle({ scriptText: "", isDropshipping: true, durationSec: null }));
    }
  }, [mode]);

  const buildScript = useCallback(() => {
    const target = pickTargetDuration(videoDuration, false);
    const g = generateScript({
      durationSec: target,
      lang,
      product: { title: productTitle },
      seed: product?.url ?? url,
    });
    setScript(g.text);
    const rec = recommendStyle({ scriptText: g.text, isDropshipping: true, durationSec: target });
    setStyleId(rec);
    setRecommended(rec);
  }, [product, url, productTitle, lang, videoDuration]);

  const canCreate =
    phase === "setup" &&
    !!file &&
    (mode === "music" ||
      (!preparingVoice && installedIds.includes(voiceId) && script.trim().length > 0));

  const start = useCallback(async () => {
    if (!file || !canCreate) return;
    if (mode === "voice" && !script.trim()) buildScript();
    setPhase("running");
    setPct(0);
    setEta(null);
    setStageLabel("Preparando");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const target = pickTargetDuration(videoDuration, mode === "music");
      const finalScript =
        script.trim() ||
        (mode === "voice"
          ? generateScript({
              durationSec: target,
              lang,
              product: { title: productTitle },
              seed: product?.url ?? url,
            }).text
          : "");
      const r = await runCreationPipeline(
        {
          script: mode === "music" ? "" : finalScript,
          voiceId: mode === "voice" ? voiceId : null,
          onlyMusic: mode === "music",
          videoBlob: file,
          videoDuration,
          preferredCategory: mode === "music" ? musicCat : null,
          styleId: mode === "voice" ? styleId ?? undefined : undefined,
        },
        {
          signal: ctrl.signal,
          onStage: (_s, _l, p, etaSec) => {
            setPct(Math.round(p));
            setEta(etaSec ?? null);
          },
        }
      );
      const name = mode === "music" ? productTitle || "Video con musica" : productTitle || finalScript.slice(0, 42);
      await saveClip(
        {
          id: r.projectId,
          name,
          thumbnail: r.thumbnail,
          duration: r.duration,
          width: r.width,
          height: r.height,
          voiceName: r.voiceName,
          musicTrack: r.musicTrackName,
          cuesCount: r.cuesCount,
          onlyMusic: mode === "music",
          createdAt: Date.now(),
        },
        r.blob
      );
      setResult(r);
      setPhase("done");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Fallo al crear el video");
      setPhase("error");
    }
  }, [file, canCreate, mode, script, buildScript, product, url, productTitle, lang, voiceId, videoDuration, musicCat, styleId, saveClip]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase("setup");
    setStep(1);
    setResult(null);
    setErrMsg("");
    setFile(null);
    setThumb(null);
    setProduct(null);
    setManualName("");
    setUrl("");
    setScript("");
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-white">Crear anuncio</h1>
        <p className="mt-1 text-sm text-gray-400">
          Sube tu video, elige el modo y creamos el anuncio con los mejores momentos.
        </p>
      </header>

      {phase === "setup" && (
        <Stepper step={step} />
      )}

      {/* PASO 1: video + modo */}
      {phase === "setup" && step === 1 && (
        <div className="space-y-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-10 text-center hover:border-violet-400/60"
          >
            {thumb ? (
              <img src={thumb} alt="video" className="mb-3 max-h-44 rounded-xl" />
            ) : (
              <div className="mb-2 text-3xl text-violet-300">+</div>
            )}
            <div className="text-sm font-semibold text-gray-100">
              {file ? file.name : "Toca para subir video"}
            </div>
            {videoDuration > 0 && (
              <div className="mt-1 text-xs text-gray-400">Duracion {videoDuration.toFixed(1)} s</div>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            {(["voice", "music"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-2xl border px-4 py-4 text-left ${
                  mode === m ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="text-sm font-semibold text-white">
                  {m === "voice" ? "Voz y subtitulos" : "Solo musica"}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {m === "voice"
                    ? "Locucion + texto en pantalla."
                    : "Tu video con musica de fondo."}
                </div>
              </button>
            ))}
          </div>

          <button
            disabled={!file}
            onClick={goStep2}
            className="cc-btn-primary w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            Continuar
          </button>
        </div>
      )}

      {/* PASO 2: detalles */}
      {phase === "setup" && step === 2 && (
        <div className="space-y-4">
          {mode === "voice" ? (
            <>
              <section className="cc-card p-5">
                <label className="text-sm font-semibold text-gray-200">Producto (AliExpress)</label>
                <div className="mt-3 flex gap-2">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadProduct()}
                    placeholder="https://es.aliexpress.com/item/..."
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-violet-400/60"
                  />
                  <button
                    onClick={loadProduct}
                    disabled={loadingProduct}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium hover:bg-white/5 disabled:opacity-50"
                  >
                    {loadingProduct ? "Buscando" : "Usar"}
                  </button>
                </div>
                {productNote && <div className="mt-2 text-xs text-amber-200">{productNote}</div>}
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Nombre del producto (opcional)"
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-violet-400/60"
                />
                {product && (product.price || product.images.length > 0) && (
                  <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                    {product.images[0] && (
                      <img src={product.images[0]} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    )}
                    <div>
                      <div className="text-gray-200">{product.title || manualName || "Producto"}</div>
                      {product.price && <div className="text-emerald-300">{product.price} {product.currency}</div>}
                    </div>
                  </div>
                )}
              </section>

              <VoicePanel
                voiceId={voiceId}
                onVoice={setVoiceId}
                styleId={styleId}
                onStyle={setStyleId}
                recommended={recommended}
                lang={lang}
                installedIds={installedIds}
                preparingVoice={preparingVoice}
                preparePct={preparePct}
                scriptText={script}
              />

              <section className="cc-card p-5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-200">Guion</label>
                  <button
                    onClick={buildScript}
                    className="text-xs font-medium text-violet-300 hover:text-violet-200"
                  >
                    Generar guion
                  </button>
                </div>
                {script ? (
                  <ScriptPanel script={script} onChange={setScript} targetSec={videoDuration} lang={lang} styleId={styleId ?? recommended} />
                ) : (
                  <p className="mt-3 text-sm text-gray-500">
                    Pulsa Generar guion para crear el texto desde el producto.
                  </p>
                )}
              </section>
            </>
          ) : (
            <section className="cc-card p-5">
              <label className="text-sm font-semibold text-gray-200">Estilo de musica</label>
              <div className="mt-3 flex flex-wrap gap-2">
                {MUSIC_CHOICES.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => setMusicCat(c.cat)}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      musicCat === c.cat ? "border-violet-400/70 bg-violet-500/10 text-white" : "border-white/10 text-gray-300 hover:bg-white/5"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Eligemos la musica que mejor encaja. Tu video se monta con sus mejores momentos.
              </p>
            </section>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-gray-300 hover:bg-white/5"
            >
              Atras
            </button>
            <button
              onClick={() => setStep(3)}
              className="cc-btn-primary flex-1 rounded-xl px-4 py-3 text-sm font-bold text-white"
            >
              Revisar
            </button>
          </div>
        </div>
      )}

      {/* PASO 3: revisar + crear */}
      {phase === "setup" && step === 3 && (
        <div className="space-y-4">
          <section className="cc-card p-5">
            <div className="flex items-center gap-3">
              {thumb && <img src={thumb} alt="" className="h-20 w-14 rounded-lg object-cover" />}
              <div>
                <div className="text-sm font-semibold text-white">
                  {mode === "voice" ? "Voz y subtitulos" : "Solo musica"}
                </div>
                <div className="text-xs text-gray-400">
                  {mode === "voice"
                    ? `${getVoiceById(voiceId)?.name} · ${productTitle || "Producto"}`
                    : `Musica: ${MUSIC_CHOICES.find((c) => c.cat === musicCat)?.label ?? "Automatica"}`}
                </div>
              </div>
            </div>
            {mode === "voice" && script && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{script}</p>
            )}
          </section>

          <button
            disabled={!canCreate}
            onClick={start}
            className="cc-btn-primary w-full rounded-xl px-4 py-3.5 text-base font-bold text-white disabled:opacity-40"
          >
            Crear anuncio
          </button>
          <button
            onClick={() => setStep(2)}
            className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-gray-300 hover:bg-white/5"
          >
            Atras
          </button>
        </div>
      )}

      {/* PROGRESO */}
      {phase === "running" && (
        <div className="cc-card p-6 text-center">
          <div className="text-sm font-semibold text-white">{stageLabel}</div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <div className="mt-2 text-xs text-gray-400">
            {pct}%{eta != null && eta > 0 ? ` · Quedan ~${Math.ceil(eta)} s` : ""}
          </div>
          <p className="mt-3 text-xs text-gray-600">Puedes cerrar esta pantalla; el proceso sigue en tu dispositivo.</p>
        </div>
      )}

      {/* ERROR */}
      {phase === "error" && (
        <div className="cc-card p-6 text-center">
          <div className="text-sm font-semibold text-red-300">No se pudo crear</div>
          <p className="mt-2 text-xs text-gray-400">{errMsg}</p>
          <button onClick={reset} className="cc-btn-primary mt-4 rounded-xl px-4 py-3 text-sm font-bold text-white">
            Intentar de nuevo
          </button>
        </div>
      )}

      {/* RESULTADO */}
      {phase === "done" && result && (
        <div className="space-y-4">
          <div className="cc-card overflow-hidden p-0">
            <video src={result.url} controls className="w-full bg-black" />
          </div>
          <div className="cc-card p-5">
            <div className="text-sm font-semibold text-white">{result.name}</div>
            <div className="mt-1 text-xs text-gray-400">
              {result.duration.toFixed(1)} s · {result.width}x{result.height}
              {result.voiceName ? ` · Voz: ${result.voiceName}` : ""}
              {result.musicTrackName ? ` · ${result.musicTrackName}` : ""}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={result.url} download className="cc-btn-primary rounded-xl px-4 py-2.5 text-sm font-bold text-white">
                Descargar
              </a>
              <button onClick={reset} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/5">
                Crear otro
              </button>
              <button onClick={() => router.push("/videos")} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/5">
                Mis videos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AppShell>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels = ["Video", "Detalles", "Crear"];
  return (
    <div className="mb-5 flex items-center gap-2">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        return (
          <div key={l} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                step >= n ? "bg-violet-500 text-white" : "bg-white/10 text-gray-400"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-xs ${step >= n ? "text-gray-200" : "text-gray-500"}`}>{l}</span>
            {i < labels.length - 1 && <div className="h-px flex-1 bg-white/10" />}
          </div>
        );
      })}
    </div>
  );
}
