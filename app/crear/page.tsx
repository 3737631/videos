"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeVideoFile } from "@/lib/media/probe";
import { fetchProduct, parseAliUrl, extractAliNameFromUrl, type ProductInfo } from "@/lib/product/aliextract";
import { generateScript } from "@/lib/script/generator";
import { defaultVoiceForLocale, VOICE_CATALOG } from "@/lib/voices/catalog";
import { ensureVoiceInstalled, isVoiceInstalled } from "@/lib/voices/engine";
import { ensurePiperRuntime } from "@/lib/voices/piperRuntime";
import { recommendStyle } from "@/lib/script/styles";
import { runCreationPipeline } from "@/lib/pipeline";
import { saveClip } from "@/lib/clips";
import { mergeVideos } from "@/lib/video/merge";
import { pickTargetDuration } from "@/lib/video/highlights";
import { detectWatermark } from "@/lib/watermark";
import { AppShell } from "@/components/AppShell";

type Mode = "voice" | "music";
type Phase = "setup" | "running" | "done" | "error";

const MUSIC_CHOICES: Array<{ label: string; cat: string | null }> = [
  { label: "Automatica", cat: null },
  { label: "Viral", cat: "viral" },
  { label: "Relajante", cat: "relaxing" },
  { label: "Motivadora", cat: "motivational" },
  { label: "Divertida", cat: "funny" },
  { label: "Elegante", cat: "dramatic" },
  { label: "Historia", cat: "storytelling" },
];

export default function CrearPage() {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [busyMerge, setBusyMerge] = useState(false);

  const [mode, setMode] = useState<Mode>("voice");
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [productNote, setProductNote] = useState("");
  const [manualName, setManualName] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState("");

  const [musicCat, setMusicCat] = useState<string | null>(null);

  // Marca de agua: la detectamos al subir el video y ofrecemos quitarla.
  const [hasWatermark, setHasWatermark] = useState(false);
  const [removeWm, setRemoveWm] = useState(true);

  const [voiceId, setVoiceId] = useState<string>(defaultVoiceForLocale("es-XX"));
  const [styleId, setStyleId] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [lang, setLang] = useState("es");
  const [, setRecommended] = useState<string>("natural");

  const [phase, setPhase] = useState<Phase>("setup");
  const [stageKey, setStageKey] = useState("");
  const [stageLabel, setStageLabel] = useState("");
  const [pct, setPct] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [result, setResult] = useState<null | Awaited<ReturnType<typeof runCreationPipeline>>>(null);
  const [errMsg, setErrMsg] = useState("");

  const [preparingVoice, setPreparingVoice] = useState<string | null>(null);
  const [preparePct, setPreparePct] = useState<number | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const urlRefs = useRef<string[]>([]);

  useEffect(() => {
    setInstalledIds(VOICE_CATALOG.filter((v) => isVoiceInstalled(v.id)).map((v) => v.id));
  }, []);

  useEffect(() => {
    if (mode !== "voice" || !mergedBlob) return;
    let alive = true;
    const ctrl = new AbortController();
    setPreparingVoice(voiceId);
    setPreparePct(0);
    (async () => {
      try {
        // Precarga EN PARALELO el modelo (0-70%) y el motor ORT (70-100%) con
        // progreso real. Así al pulsar "Crear" solo queda la inferencia (rápida)
        // y no la descarga de ~58MB que antes congelaba la barra durante el render.
        await Promise.all([
          ensureVoiceInstalled(voiceId, {
            signal: ctrl.signal,
            onProgress: (p) => alive && setPreparePct(Math.round((p ?? 0) * 70)),
          }),
          ensurePiperRuntime(
            (l, t) => alive && setPreparePct(Math.round(70 + (l / (t || l)) * 30)),
            ctrl.signal
          ),
        ]);
        if (!alive) return;
        setInstalledIds(VOICE_CATALOG.filter((v) => isVoiceInstalled(v.id)).map((v) => v.id));
        setPreparingVoice(null);
        setPreparePct(null);
      } catch {
        if (alive) {
          setPreparingVoice(null);
          setPreparePct(null);
        }
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [mode, voiceId, mergedBlob]);

  const onPickFiles = useCallback(async (list: File[]) => {
    if (!list.length) return;
    setHasWatermark(false);
    setRemoveWm(true);
    urlRefs.current.forEach((u) => URL.revokeObjectURL(u));
    urlRefs.current = [];
    setFiles(list);
    setThumbs([]);
    setMergedBlob(null);
    setBusyMerge(list.length > 1);

    const tUrls: string[] = [];
    const tImages: string[] = [];
    for (const f of list) {
      const u = URL.createObjectURL(f);
      tUrls.push(u);
      const v = document.createElement("video");
      v.src = u;
      v.muted = true;
      v.onloadeddata = () => {
        const cv = document.createElement("canvas");
        cv.width = 200;
        cv.height = Math.round((200 * v.videoHeight) / v.videoWidth) || 356;
        cv.getContext("2d")?.drawImage(v, 0, 0, cv.width, cv.height);
        try {
          tImages.push(cv.toDataURL("image/jpeg", 0.7));
          setThumbs([...tImages]);
        } catch {}
      };
    }
    urlRefs.current = tUrls;

    try {
      const merged = list.length > 1 ? await mergeVideos(list) : list[0];
      const probe = await analyzeVideoFile(merged as unknown as File, { timeoutMs: 20000 });
      setMergedBlob(merged);
      setVideoDuration(probe.duration || 0);
      // Detección de marca de agua (no bloquea: si tarda, se ignora).
      const wmUrl = URL.createObjectURL(merged as unknown as Blob);
      detectWatermark(wmUrl).then((wm) => setHasWatermark(wm)).catch(() => setHasWatermark(false)).finally(() => {
        try { URL.revokeObjectURL(wmUrl); } catch {}
      });
    } catch {
      setMergedBlob(list[0]);
      setVideoDuration(0);
    } finally {
      setBusyMerge(false);
    }
  }, []);

  const loadProduct = useCallback(async () => {
    const raw = url.trim();
    const parsed = parseAliUrl(raw);
    const slug = extractAliNameFromUrl(raw);
    // Móvil: s.click/a.aliexpress y links sin ID numérico - lectura instantánea 0s
    const isAliHost = /aliexpress|ali\.express/i.test(raw);
    if (!parsed && !slug && !isAliHost) {
      setProductNote("Pega un enlace válido de AliExpress.");
      return;
    }
    // Lectura instantánea en móvil: muestra nombre del slug o genérico sin esperar red (0s vs 5s)
    if (slug) {
      const instant: ProductInfo = {
        url: raw,
        itemId: parsed?.itemId ?? null,
        title: slug,
        price: null,
        currency: null,
        images: [],
        videoUrls: [],
        seller: null,
        description: null,
        features: [],
      };
      setProduct(instant);
      setManualName(slug);
      setProductNote("Nombre del enlace listo — enriqueciendo datos…");
      setLoadedUrl(raw);
    } else if (isAliHost) {
      const genericTitle = parsed?.itemId ? `Producto AliExpress ${parsed.itemId}` : "Producto AliExpress";
      const instant: ProductInfo = {
        url: raw,
        itemId: parsed?.itemId ?? null,
        title: genericTitle,
        price: null,
        currency: null,
        images: [],
        videoUrls: [],
        seller: null,
        description: null,
        features: [],
      };
      setProduct(instant);
      setManualName(genericTitle);
      setProductNote("Enlace móvil detectado — puedes editar el nombre abajo.");
      setLoadedUrl(raw);
    } else {
      setProductNote("");
      setLoadedUrl(raw);
    }
    setLoadingProduct(true);
    try {
      const res = await fetchProduct(raw, { timeoutMs: 5000 });
      // Solo sobrescribe si trae datos mejores que el slug instantáneo
      if (res.info.title && res.info.title.length > 3) {
        setProduct(res.info);
        setManualName(res.info.title ?? slug ?? "");
        if (res.usedUrlName) setProductNote("La página pedía captcha; usamos el nombre del enlace.");
        else if (res.source === "none") setProductNote("Usando nombre del enlace.");
        else if (!res.info.title) setProductNote("Falta el nombre. Escríbelo abajo.");
        else setProductNote("");
      } else if (!slug) {
        const genericTitle = res.info.title || (parsed?.itemId ? `Producto AliExpress ${parsed.itemId}` : "Producto AliExpress");
        const genericInfo: ProductInfo = { ...res.info, title: genericTitle };
        setProduct(genericInfo);
        setManualName(genericTitle);
        if (res.source === "none") setProductNote("Usando nombre genérico — puedes editarlo abajo.");
        else setProductNote("");
      }
    } catch {
      if (!slug) {
        const genericTitle = parsed?.itemId ? `Producto AliExpress ${parsed.itemId}` : "Producto AliExpress";
        const genericInfo: ProductInfo = {
          url: raw,
          itemId: parsed?.itemId ?? null,
          title: genericTitle,
          price: null,
          currency: null,
          images: [],
          videoUrls: [],
          seller: null,
          description: null,
          features: [],
        };
        setProduct(genericInfo);
        setManualName(genericTitle);
        setProductNote("Usando nombre genérico — puedes editarlo abajo.");
      }
      // si ya teníamos slug, mantenemos el instantáneo
    } finally {
      setLoadingProduct(false);
    }
  }, [url]);

  // AliExpress: si la URL es válida (incluido s.click móvil), se analiza siempre para guion
  useEffect(() => {
    const raw = url.trim();
    if ((parseAliUrl(raw) || extractAliNameFromUrl(raw) || /aliexpress|ali\.express/i.test(raw)) && raw !== loadedUrl) loadProduct();
  }, [url, loadedUrl, loadProduct]);

  const productTitle = manualName.trim() || product?.title || null;

  const buildScript = useCallback(() => {
    const target = pickTargetDuration(videoDuration, false);
    // Guion 100% ligado a producto + duración: pasa título, precio, moneda, features y vendedor
    const g = generateScript({
      durationSec: target,
      lang,
      product: {
        title: productTitle,
        price: product?.price ?? null,
        currency: product?.currency ?? null,
        features: product?.features ?? [],
        seller: product?.seller ?? null,
      },
    });
    setScript(g.text);
    // Tono publicitario por defecto para producto (viral/urgente), no storytelling lento
    const rec = recommendStyle({ scriptText: g.text, isDropshipping: true, durationSec: target });
    const adStyle: string = productTitle ? (target <= 16 ? "viral" : "energetico") : rec;
    setStyleId(adStyle);
    setRecommended(adStyle);
  }, [videoDuration, lang, productTitle, product]);

  // Auto-guion: en cuanto hay producto y duración, crea el guion justo para esa duración y lo muestra abajo para solo leerlo
  useEffect(() => {
    if (!productTitle || !videoDuration || script.trim() || phase !== "setup" || mode === "music") return;
    buildScript();
  }, [productTitle, videoDuration, phase, mode, script, buildScript]);

  const aliOk = !!(parseAliUrl(url.trim()) || extractAliNameFromUrl(url.trim()) || /aliexpress|ali\.express/i.test(url.trim())) && !!productTitle;
  // En "solo música" el enlace de producto NO es necesario (el guion va vacío
  // y el nombre es "Video con música"); solo se exige en modo con voz.
  const canCreate =
    phase === "setup" &&
    !!mergedBlob &&
    (mode === "music" || aliOk) &&
    (mode === "music" || (!preparingVoice && installedIds.includes(voiceId)));

  const start = useCallback(async () => {
    if (!mergedBlob || !canCreate) return;
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
              product: {
                title: productTitle,
                price: product?.price ?? null,
                currency: product?.currency ?? null,
                features: product?.features ?? [],
                seller: product?.seller ?? null,
              },
            }).text
          : "");
      const r = await runCreationPipeline(
        {
          script: mode === "music" ? "" : finalScript,
          voiceId: mode === "voice" ? voiceId : null,
          onlyMusic: mode === "music",
          videoBlob: mergedBlob,
          videoDuration,
          preferredCategory: musicCat,
          styleId: mode === "voice" ? (styleId as string | undefined) : undefined,
          removeWatermark: removeWm,
        },
        {
          signal: ctrl.signal,
          onStage: (_s, _l, p, etaSec) => {
            setStageKey(_s);
            setStageLabel(_l);
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
  }, [mergedBlob, canCreate, mode, script, buildScript, videoDuration, lang, productTitle, voiceId, musicCat, styleId, saveClip]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase("setup");
    setResult(null);
    setErrMsg("");
    setFiles([]);
    setThumbs([]);
    setMergedBlob(null);
    setProduct(null);
    setManualName("");
    setUrl("");
    setLoadedUrl("");
    setScript("");
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-6">
        <header className="mb-5">
          <h1 className="text-xl font-bold text-white">Crear anuncio</h1>
          <p className="mt-1 text-sm text-gray-400">
            Sube uno o varios videos. Elegimos los mejores momentos y los unimos.
          </p>
        </header>

        {phase === "setup" && (
          <div className="space-y-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-8 text-center hover:border-violet-400/60"
            >
              <div className="mb-2 text-2xl text-violet-300">+</div>
              <div className="text-sm font-semibold text-gray-100">
                Sube tu video {files.length === 0 ? "" : `(${files.length})`}
              </div>
              <div className="mt-1 text-xs text-gray-500">Puedes subir varios a la vez</div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => onPickFiles(Array.from(e.target.files ?? []))}
            />

            {busyMerge && <div className="text-center text-xs text-gray-400">Uniendo videos…</div>}

            {thumbs.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {thumbs.map((t, i) => (
                  <img key={i} src={t} alt="" className="aspect-[9/16] w-full rounded-lg object-cover" />
                ))}
              </div>
            )}
            {videoDuration > 0 && (
              <div className="text-center text-xs text-gray-400">Duracion total {videoDuration.toFixed(1)} s</div>
            )}

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
                    {m === "voice" ? "Con voz" : "Solo musica"}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {m === "voice" ? "Voz + subtitulos." : "Tu video con musica."}
                  </div>
                </button>
              ))}
            </div>

            <section className="cc-card p-4">
              <div className="text-xs font-semibold text-gray-300">Estilo de musica</div>
              <div className="mt-2 flex flex-wrap gap-2">
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
            </section>

            <section className="cc-card p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-200">
                  Producto de AliExpress{" "}
                  {mode === "music" ? (
                    <span className="text-gray-400">(opcional)</span>
                  ) : (
                    <span className="text-rose-300">* obligatorio</span>
                  )}
                </div>
                {productTitle && (
                  <div className="text-xs font-medium text-emerald-300">Analizado</div>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadProduct()}
                  placeholder="https://es.aliexpress.com/item/..."
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60"
                />
                <button
                  onClick={loadProduct}
                  disabled={loadingProduct}
                  className="rounded-xl border border-white/15 px-3 py-2 text-sm font-medium hover:bg-white/5 disabled:opacity-50"
                >
                  {loadingProduct
                    ? "Buscando…"
                    : productTitle && loadedUrl === url
                    ? "Confirmado âœ“"
                    : "Buscar"}
                </button>
              </div>
              {productNote && <div className="mt-2 text-xs text-amber-200">{productNote}</div>}
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nombre del producto (se rellena solo; corrigelo si hace falta)"
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60"
              />
            </section>

            {script && (
              <section className="cc-card p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-gray-200">Guion personalizado</div>
                  <div className="text-xs text-gray-400">{script.split(/\s+/).filter(Boolean).length} palabras · ~{pickTargetDuration(videoDuration, false)}s</div>
                </div>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60"
                  placeholder="Guion generado automáticamente según producto y duración..."
                />
                <div className="mt-1 flex gap-2">
                  <button onClick={buildScript} className="text-xs text-violet-300 hover:text-violet-200">⟳ Regenerar</button>
                  <span className="text-xs text-gray-500">Se lee en alto con tono publicitario</span>
                </div>
              </section>
            )}

            {mode === "voice" && preparingVoice && (
              <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
                Preparando voz (descarga del modelo)… {preparePct != null ? `${preparePct}%` : ""}
              </div>
            )}
            {mode === "voice" && !preparingVoice && installedIds.includes(voiceId) && (
              <div className="text-xs font-medium text-emerald-300">Voz lista</div>
            )}

            {hasWatermark && (
              <section className="cc-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-amber-200">Marca de agua detectada</div>
                    <div className="mt-1 text-xs text-gray-400">
                      Recortamos los bordes para quitarla del vídeo final.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRemoveWm((v) => !v)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      removeWm ? "bg-violet-500" : "bg-white/15"
                    }`}
                    aria-pressed={removeWm}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                        removeWm ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </section>
            )}

            <button
              disabled={!canCreate}
              onClick={start}
              className="cc-btn-primary w-full rounded-xl px-4 py-3.5 text-base font-bold text-white disabled:opacity-40"
            >
              Crear anuncio
            </button>
          </div>
        )}

        {phase === "running" && (
          <div className="cc-card p-6 text-center">
            <div className="text-sm font-semibold text-white">{stageLabel}</div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
            <div className="mt-2 text-xs text-gray-400">
              {pct}%{eta != null && eta > 0 ? ` · Quedan ~${Math.ceil(eta)} s` : ""}
            </div>
            {stageKey === "GENERATING_VOICE" && (
              <div className="mt-2 text-xs text-violet-200">
                Cargando el modelo de voz en tu móvil (tarda 20-30 s la primera vez). Sigue así, no cierres la página.
              </div>
            )}
            {stageKey === "RENDERING" && (
              <div className="mt-2 text-xs text-violet-200">Montando el vídeo final, esto también tarda unos segundos.</div>
            )}
            <button
              onClick={reset}
              className="mt-4 rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/5"
            >
              Cancelar
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="cc-card p-6 text-center">
            <div className="text-sm font-semibold text-red-300">No se pudo crear</div>
            <p className="mt-2 text-xs text-gray-400">{errMsg}</p>
            <button onClick={reset} className="cc-btn-primary mt-4 rounded-xl px-4 py-3 text-sm font-bold text-white">
              Intentar de nuevo
            </button>
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-4">
            <div className="cc-card overflow-hidden p-0">
              <video src={result.url} controls className="w-full bg-black" />
            </div>
            {result.voiceError && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                <div className="font-semibold">La voz falló (se usó solo música). Error real:</div>
                <div className="mt-1 break-words font-mono text-xs">{result.voiceError}</div>
                <button
                  onClick={() => navigator.clipboard?.writeText(result.voiceError ?? "")}
                  className="mt-2 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/20"
                >
                  Copiar error
                </button>
                <div className="mt-2 text-xs text-rose-200/80">Pégalo aquí para arreglar la causa exacta de una vez.</div>
              </div>
            )}
            <div className="cc-card p-5">
              <div className="text-sm font-semibold text-white">{result.name}</div>
              <div className="mt-1 text-xs text-gray-400">
                {result.duration.toFixed(1)} s · {result.width}x{result.height}
                {result.voiceName ? ` · ${result.voiceName}` : ""}
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



