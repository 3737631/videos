"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProjectActions, useSettings } from "@/lib/useStore";
import type {
  Project,
  SourceVideo,
  VideoMetadata,
  HookOption,
  ScriptSegment,
} from "@/types";
import { buildEditPlan, getScriptFullText } from "@/lib/editplan";
import { generateHooks, generateScript, generateCta, transcribeWithTimestamps } from "@/lib/ai";
import { generateSpeech, getVoiceById, previewVoice, stopPreview } from "@/lib/tts";
import { serviceStatus } from "@/lib/storage";
import { analyzeVideo } from "@/lib/analyze";
import { PRESETS, TARGET_DURATIONS, VIDEO_GOALS, VIDEO_STYLES } from "@/lib/presets";
import { detectViralHighlights, losslessCut, type ViralSegment } from "@/lib/viral";
import { loadFfmpeg } from "@/lib/ffmpeg";

function newProject(): Project {
  const id = crypto.randomUUID();
  return {
    id,
    name: "Nuevo vídeo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "draft",
    sources: [],
    metadata: null,
    style: "viral",
    goal: "engagement",
    targetDuration: "auto",
    hooks: [],
    selectedHook: "",
    script: [],
    voice: null,
    subtitles: { cues: [], style: { font: "system-ui", size: 72, weight: 800, color: "#fff", activeColor: "#fde047", shadow: true, stroke: false, strokeColor: "#000", position: "bottom", maxWidth: 86, animation: "pop" } },
    music: null,
    editPlan: null,
    renders: [],
    thumbnail: "",
  };
}

const FALLBACK_HOOKS: HookOption[] = [
  { id: "h1", text: "Wait for it… 🤯", score: 0.9 },
  { id: "h2", text: "You won't believe what happens next", score: 0.85 },
  { id: "h3", text: "POV: this changed everything", score: 0.8 },
];

function fallbackScript(hookText: string): ScriptSegment[] {
  return [
    { kind: "hook", text: hookText },
    { kind: "desarrollo", text: "Here is the moment everyone is talking about — watch closely." },
    { kind: "beneficio", text: "This trick makes your content pop instantly." },
    { kind: "cta", text: "Follow for more viral clips like this." },
  ];
}

function statusBadge(status: Project["status"]) {
  const map: Record<Project["status"], string> = {
    draft: "bg-gray-500/15 text-gray-300",
    processing: "bg-blue-500/15 text-blue-300 animate-pulse-soft",
    ready: "bg-emerald-500/15 text-emerald-300",
    failed: "bg-red-500/15 text-red-300",
    exported: "bg-fuchsia-500/15 text-fuchsia-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>
  );
}

export default function CrearPage() {
  const { saveProject } = useProjectActions();
  const [settings] = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project>(newProject);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"analyzing" | "creating" | "cutting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [jobStage, setJobStage] = useState<{ stage: string; progress: number } | null>(null);
  const [generatedCtas, setGeneratedCtas] = useState<string[]>([]);
  const [viralSegs, setViralSegs] = useState<ViralSegment[]>([]);
  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const [cutDur, setCutDur] = useState(0);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"voz" | "musica">("voz");

  const update = (patch: Partial<Project>) => {
    setProject((p) => {
      const next = { ...p, ...patch, updatedAt: new Date().toISOString() };
      saveProject(next);
      return next;
    });
  };

  const addLog = (msg: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} - ${msg}`]);

  function errText(e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }

  async function runAnalysis(src: SourceVideo) {
    let metadata: VideoMetadata;
    try {
      metadata = await analyzeVideo(src, (stage, progress) =>
        setJobStage({ stage: `Analizando: ${stage}`, progress: 25 + progress * 0.35 })
      );
      addLog("Análisis completado");
    } catch {
      metadata = minimalMetadata(src);
      addLog("Análisis básico aplicado (el vídeo se procesará igualmente)");
    }
    update({ metadata });

    try {
      const segs = await detectViralHighlights(src, () => {});
      setViralSegs(segs);
      addLog(`Momentos virales detectados: ${segs.length}`);
    } catch {
      setViralSegs([]);
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|3gp)$/i.test(f.name)
    );
    if (!list.length) {
      setError("Formato no soportado. Usa MP4, MOV (galería del iPhone), WEBM o AVI.");
      return;
    }
    setError(null);
    setCutUrl(null);
    setViralSegs([]);
    setBusy("analyzing");
    setJobStage({ stage: "Leyendo vídeo", progress: 5 });
    addLog(`Procesando ${list.length} archivo(s)...`);

    try {
      const sources: SourceVideo[] = [];
      for (const file of list) {
        const url = URL.createObjectURL(file);
        const meta = await probeVideoMeta(url);
        sources.push({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type || "video/mp4",
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          hasAudio: meta.hasAudio,
        });
      }
      const main = sources[0];
      update({
        sources,
        name: main.name.replace(/\.[^.]+$/, ""),
        thumbnail: main.url,
      });

      await runAnalysis(main);
      setJobStage({ stage: "Listo", progress: 100 });
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function reanalyze() {
    const src = project.sources[0];
    if (!src || busy !== null) return;
    setError(null);
    setBusy("analyzing");
    setJobStage({ stage: "Analizando vídeo", progress: 20 });
    try {
      await runAnalysis(src);
      setJobStage({ stage: "Listo", progress: 100 });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
      setJobStage(null);
    }
  }

  async function handleCreate() {
    if (!project.sources.length) {
      setError("Sube primero un vídeo.");
      return;
    }
    setError(null);
    setBusy("creating");
    addLog("Creando vídeo viral...");

    const base = project;
    try {
      const metaText = base.metadata?.analysisText || "Vídeo vertical corto.";

      setJobStage({ stage: "Generando hooks", progress: 10 });
      let hooks: HookOption[] = [];
      try {
        hooks = await generateHooks(settings, metaText);
      } catch {
        hooks = [];
      }
      if (!hooks.length) hooks = FALLBACK_HOOKS;
      const selectedHook = hooks[0].text;
      addLog(`Hook elegido: "${selectedHook}"`);

      setJobStage({ stage: "Generando guion", progress: 30 });
      let script: ScriptSegment[] = [];
      try {
        script = await generateScript(settings, metaText, hooks, selectedHook, base.style, base.goal);
      } catch {
        script = [];
      }
      if (!script.length) script = fallbackScript(selectedHook);

      let localVoiceUrl: string | null = null;
      let ttsBlob: Blob | null = null;
      if (voiceMode === "musica") {
        addLog("Modo solo música: se omite la voz");
      } else {
        setJobStage({ stage: "Generando voz", progress: 50 });
        if (serviceStatus(settings, "tts").configured) {
          const fullText = getScriptFullText({ ...base, script });
          if (fullText.trim()) {
            try {
              const voice = await generateSpeech(settings, fullText, settings.ttsVoiceId || "alloy", { speed: 1 });
              if (await validateVoiceBlob(voice.url)) {
                ttsBlob = voice.blob;
                localVoiceUrl = voice.url;
                addLog(`Voz generada (${voice.duration.toFixed(1)}s)`);
              }
            } catch (e) {
              addLog(`Voz omitida: ${errText(e)}`);
            }
          }
        } else {
          addLog("Sin clave TTS: se omite la voz (configúrala en Ajustes)");
        }
      }

      let cues: Project["subtitles"]["cues"] = [];
      if (ttsBlob && serviceStatus(settings, "stt").configured) {
        setJobStage({ stage: "Generando subtítulos", progress: 65 });
        try {
          cues = await transcribeWithTimestamps(settings, ttsBlob);
          addLog(`Subtítulos: ${cues.length} bloques`);
        } catch {
          addLog("Subtítulos omitidos");
        }
      }

      setJobStage({ stage: "Generando CTA", progress: 80 });
      let ctas: string[] = [];
      try {
        ctas = await generateCta(settings, base.goal);
      } catch {
        ctas = [];
      }
      if (!ctas.length) ctas = ["Follow for more!"];
      setGeneratedCtas(ctas);

      setJobStage({ stage: "Construyendo plan de edición", progress: 92 });
      const next: Project = {
        ...base,
        hooks,
        selectedHook,
        script,
        subtitles: { ...base.subtitles, cues },
        voice: localVoiceUrl
          ? {
              voiceId: settings.ttsVoiceId || "alloy",
              voiceName: getVoiceById(settings.ttsVoiceId || "alloy").name,
              provider: settings.ttsProvider,
              speed: 1,
              pitch: 1,
            }
          : base.voice,
      };
      const plan = buildEditPlan(next);
      next.editPlan = plan;
      next.status = "ready";
      next.updatedAt = new Date().toISOString();
      setProject(next);
      saveProject(next);

      if (localVoiceUrl) setVoiceUrl(localVoiceUrl);
      setJobStage({ stage: "Listo", progress: 100 });
      addLog(
        voiceMode === "musica"
          ? "¡Vídeo creado en modo solo música! Ya puedes exportarlo."
          : "¡Vídeo viral creado! Puedes escuchar la voz arriba."
      );
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      setBusy(null);
      setJobStage(null);
    }
  }

  async function handleViralCut() {
    const src = project.sources[0];
    if (!src || !viralSegs.length || busy !== null) return;
    setError(null);
    setBusy("cutting");
    setJobStage({ stage: "Preparando recorte", progress: 5 });
    try {
      addLog("Recortando momentos virales sin pérdida de calidad...");
      const ff = await loadFfmpeg((line) => void line);
      const res = await losslessCut(ff, src, viralSegs, (stage, progress) =>
        setJobStage({ stage, progress })
      );
      setCutUrl(res.url);
      setCutDur(res.duration);
      addLog(`Recorte viral listo (${res.duration.toFixed(1)}s, sin recodificar)`);
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      setBusy(null);
      setJobStage(null);
    }
  }

  function togglePreview() {
    if (previewing) {
      stopPreview();
      setPreviewing(false);
      return;
    }
    const ok = previewVoice(getVoiceById(settings.ttsVoiceId || "alloy"));
    setPreviewing(ok);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const selectedVoice = getVoiceById(settings.ttsVoiceId || "alloy");
  const hasSource = project.sources.length > 0;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Crear vídeo viral</h1>
            <p className="text-sm text-gray-400 mt-1">
              Sube tu vídeo y se hace todo solo: análisis, momentos virales, voz en inglés y edición.
            </p>
          </div>
          <div>{statusBadge(project.status)}</div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200" aria-label="Cerrar">
              ✕
            </button>
          </div>
        )}

        {jobStage && (
          <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex justify-between text-sm text-blue-200">
              <span>{busy === "creating" ? "🤖" : busy === "cutting" ? "✂️" : "🔍"} {jobStage.stage}</span>
              <span>{Math.round(jobStage.progress)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-900/50 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${jobStage.progress}%` }} />
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">1 · Sube tu vídeo</h2>
            <p className="text-xs text-gray-400 mt-1">
              Desde la galería del iPhone (.mov/.mp4), PC o cualquier sitio.
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
              className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                dragging ? "border-blue-500 bg-blue-500/10" : "border-white/15 hover:border-blue-400/50"
              }`}
            >
              <span className="text-3xl">📱</span>
              <span className="mt-2 text-sm">Toca para elegir de tu galería</span>
              <span className="mt-1 text-xs text-gray-400">MP4 · MOV · WEBM</span>
              <input
                ref={fileInput}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>

            {project.sources.map((s) => (
              <div key={s.id} className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 p-2.5">
                <video src={s.url} muted playsInline preload="metadata" className="h-14 w-10 rounded object-cover bg-black" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{s.name}</div>
                  <div className="text-xs text-gray-400">
                    {s.width > 0 ? `${s.width}×${s.height} · ` : ""}
                    {s.duration > 0 ? `${s.duration.toFixed(1)}s` : "duración detectando…"}
                  </div>
                </div>
              </div>
            ))}

            {hasSource && (
              <button
                onClick={reanalyze}
                disabled={busy !== null}
                className="mt-3 w-full rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50"
              >
                🔄 Volver a analizar
              </button>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">2 · Momentos virales</h2>
            <p className="text-xs text-gray-400 mt-1">
              Detecta automáticamente las partes con más gancho.
            </p>

            {!hasSource && (
              <p className="mt-6 text-sm text-gray-500 text-center">
                Sube un vídeo para ver los momentos virales aquí.
              </p>
            )}

            {hasSource && !viralSegs.length && busy === "analyzing" && (
              <p className="mt-6 text-sm text-blue-300 text-center animate-pulse-soft">
                Buscando momentos virales…
              </p>
            )}

            {hasSource && !viralSegs.length && busy !== "analyzing" && (
              <p className="mt-6 text-sm text-gray-500 text-center">
                No se detectaron momentos destacados.
              </p>
            )}

            {viralSegs.length > 0 && (
              <div className="mt-4 space-y-2">
                {viralSegs.map((seg, i) => {
                  const strength = Math.min(100, Math.round(seg.score * 40));
                  return (
                    <div key={i} className="rounded-lg bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">🔥 Viral #{i + 1}</span>
                        <span className="text-gray-400 text-xs">
                          {formatTime(seg.start)} – {formatTime(seg.end)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-fuchsia-500 to-orange-400" style={{ width: `${strength}%` }} />
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={handleViralCut}
                  disabled={busy !== null}
                  className={`w-full mt-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                    busy === "cutting"
                      ? "bg-fuchsia-600/50 cursor-wait"
                      : "bg-fuchsia-600 hover:bg-fuchsia-500"
                  }`}
                >
                  ✂️ Recortar virales (sin pérdida de calidad)
                </button>
                <p className="text-[11px] text-gray-500 text-center">
                  Recorta copiando los streams originales: cero recompresión.
                </p>
              </div>
            )}

            {cutUrl && (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="text-sm font-medium text-emerald-300 mb-2">
                  ✅ Recorte viral listo{cutDur > 0 ? ` · ${cutDur.toFixed(1)}s` : ""}
                </div>
                <video src={cutUrl} controls playsInline className="w-full rounded-lg max-h-64 bg-black" />
                <a
                  href={cutUrl}
                  download="clip-viral.mp4"
                  className="block mt-2 text-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
                >
                  ⬇️ Descargar clip viral
                </a>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">🚫 Quitar marca de agua de TikTok</div>
                <div className="text-[11px] text-gray-500">
                  Acerca el encuadre para que el @usuario y el logo queden fuera del plano: nítido, sin difuminar (se
                  aplica al exportar).
                </div>
              </div>
              <button
                onClick={() => update({ removeWatermark: !project.removeWatermark })}
                aria-pressed={!!project.removeWatermark}
                className={`shrink-0 relative w-12 h-7 rounded-full transition-colors ${
                  project.removeWatermark ? "bg-emerald-600" : "bg-white/15"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                    project.removeWatermark ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">3 · Voz y audio</h2>
            <p className="text-xs text-gray-400 mt-1">Con voz en inglés o solo con música de fondo.</p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setVoiceMode("voz")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  voiceMode === "voz" ? "bg-blue-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/15"
                }`}
              >
                🎙️ Con voz
              </button>
              <button
                onClick={() => setVoiceMode("musica")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  voiceMode === "musica" ? "bg-emerald-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/15"
                }`}
              >
                🎵 Solo música
              </button>
            </div>

            {voiceMode === "musica" ? (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="text-sm font-medium text-emerald-300">🎵 Sin voz: solo música</div>
                <div className="mt-1 text-xs text-gray-400">
                  Elige una pista en la página{" "}
                  <Link href="/musica" className="text-blue-400 hover:text-blue-300 underline">
                    Música
                  </Link>{" "}
                  y se mezclará sobre tu vídeo. También se oye el audio original de fondo.
                </div>
              </div>
            ) : (
              <>
            <div className="mt-4 rounded-lg border border-blue-500/40 bg-blue-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">
                    🔊 {selectedVoice.name} ({selectedVoice.accent})
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {selectedVoice.language} · {selectedVoice.style}
                  </div>
                </div>
                <button
                  onClick={togglePreview}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    previewing ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
                  }`}
                >
                  {previewing ? "⏹ Parar" : "▶ Escuchar"}
                </button>
              </div>
              <Link href="/voces" className="mt-2 inline-block text-xs text-blue-400 hover:text-blue-300">
                Cambiar de voz →
              </Link>
            </div>

            {voiceUrl && (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="text-sm font-medium text-emerald-300 mb-2">🎙️ Tu voz está lista:</div>
                <audio controls src={voiceUrl} className="w-full" />
              </div>
            )}
              </>
            )}

            <div className="mt-4 space-y-1.5 text-xs text-gray-400">
              <div>✅ Análisis automático del contenido</div>
              <div>✅ Hook y guion virales en inglés</div>
              <div>✅ Subtítulos llamativos (si hay claves)</div>
              <div>✅ Recorte vertical 9:16</div>
            </div>
          </section>
        </div>

        <details className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <summary className="text-sm font-semibold cursor-pointer">⚙️ Ajustes avanzados (opcional)</summary>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <span className="text-sm font-medium">Estilo</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VIDEO_STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => update({ style: s.id })}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      project.style === s.id ? "bg-blue-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Objetivo</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VIDEO_GOALS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => update({ goal: g.id })}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      project.goal === g.id ? "bg-fuchsia-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Duración</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TARGET_DURATIONS.map((d) => (
                  <button
                    key={String(d.id)}
                    onClick={() => update({ targetDuration: d.id })}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      project.targetDuration === d.id ? "bg-emerald-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-3">
              <span className="text-xs text-gray-400">Plantillas rápidas:</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => update({ style: p.style, goal: p.goal })}
                    className="rounded-md bg-white/5 px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
                    title={p.description}
                  >
                    {p.emoji} {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>

        <div className="mt-8">
          <button
            onClick={handleCreate}
            disabled={busy !== null || !hasSource}
            className={`w-full rounded-xl px-6 py-4 text-base font-bold transition-colors ${
              busy === "creating"
                ? "bg-fuchsia-600/50 cursor-wait"
                : !hasSource
                  ? "bg-white/5 text-gray-400 cursor-not-allowed"
                  : "bg-fuchsia-600 hover:bg-fuchsia-500 shadow-lg shadow-fuchsia-900/40"
            }`}
          >
            {busy === "creating"
              ? "Creando tu vídeo viral…"
              : project.editPlan
                ? "🔁 Regenerar vídeo viral"
                : "🚀 Crear vídeo viral"}
          </button>
        </div>

        {log.length > 0 && (
          <details className="mt-6 rounded-xl border border-white/10 p-4">
            <summary className="text-sm font-medium cursor-pointer">Registro de actividad</summary>
            <pre className="mt-2 text-xs text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {log.join("\n")}
            </pre>
          </details>
        )}

        {generatedCtas.length > 0 && (
          <div className="mt-6 rounded-xl border border-white/10 p-4">
            <h3 className="text-sm font-semibold">CTA generadas</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {generatedCtas.map((c, i) => (
                <span key={i} className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-gray-200">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href={`/editor?id=${project.id}`} className="text-sm text-blue-400 hover:text-blue-300">
            Abrir en el editor completo →
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

async function probeVideoMeta(url: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}> {
  return new Promise((resolve) => {
    const fallback = { duration: 0, width: 0, height: 0, fps: 30, hasAudio: true };
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const finish = (val: typeof fallback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    timer = setTimeout(() => finish(fallback), 8000);
    video.onloadedmetadata = () => {
      const dur = video.duration;
      if (isFinite(dur) && dur > 0) {
        finish({
          duration: dur,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          hasAudio: true,
        });
        return;
      }
      video.onseeked = () => {
        const d2 = video.duration;
        finish({
          duration: isFinite(d2) ? d2 : 0,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          hasAudio: true,
        });
      };
      try {
        video.currentTime = 1e6;
      } catch {
        finish({
          duration: 0,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          hasAudio: true,
        });
      }
    };
    video.onerror = () => finish(fallback);
    video.src = url;
  });
}

function minimalMetadata(src: SourceVideo): VideoMetadata {
  const duration = src.duration || 10;
  return {
    scenes: [],
    duration,
    resolution: { width: src.width || 1080, height: src.height || 1920 },
    fps: src.fps || 30,
    people: 0,
    objects: ["contenido visual"],
    speech: 0,
    silenceSegments: [],
    sceneChanges: 0,
    interestingSegments: [],
    audioLevel: 0,
    qualityScore: 70,
    analysisText: `Vídeo de ${duration.toFixed(1)}s listo para edición vertical.`,
  };
}

function formatTime(t: number): string {
  if (!t || !isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function validateVoiceBlob(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(isFinite(audio.duration) && audio.duration > 0.5);
    audio.onerror = () => resolve(false);
    audio.src = url;
  });
}
