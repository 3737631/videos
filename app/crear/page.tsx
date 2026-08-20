"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useProjectActions } from "@/lib/useStore";
import type { Project, SourceVideo, VideoMetadata } from "@/types";
import { jobs, type JobInstance } from "@/lib/jobs";
import { buildEditPlan, getScriptFullText } from "@/lib/editplan";
import { useSettings } from "@/lib/useStore";
import { generateHooks, generateScript, generateCta, transcribeWithTimestamps } from "@/lib/ai";
import { generateSpeech } from "@/lib/tts";
import { analyzeVideo } from "@/lib/analyze";
import { PRESETS, TARGET_DURATIONS, VIDEO_GOALS, VIDEO_STYLES } from "@/lib/presets";

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
    subtitles: { cues: [], style: { font: "system-ui", size: 64, weight: 800, color: "#fff", activeColor: "#fde047", shadow: true, stroke: false, strokeColor: "#000", position: "bottom", maxWidth: 86, animation: "pop" } },
    music: null,
    editPlan: null,
    renders: [],
    thumbnail: "",
  };
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
  const { saveProject, projects } = useProjectActions();
  const [settings] = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project>(newProject);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"analyzing" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [jobStage, setJobStage] = useState<{ stage: string; progress: number } | null>(null);
  const [generatedCtas, setGeneratedCtas] = useState<string[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const update = (patch: Partial<Project>) => {
    setProject((p) => {
      const next = { ...p, ...patch, updatedAt: new Date().toISOString() };
      saveProject(next);
      return next;
    });
  };

  const addLog = (msg: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} - ${msg}`]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|avi)$/i.test(f.name));
    if (!list.length) {
      setError("Formato no soportado. Usa MP4, MOV, WEBM o AVI.");
      return;
    }
    setError(null);
    setBusy("analyzing");
    setJobStage({ stage: "Leyendo vídeo", progress: 5 });
    addLog(`Procesando ${list.length} archivo(s)...`);

    try {
      const sources: SourceVideo[] = [];
      for (const file of list) {
        const url = URL.createObjectURL(file);
        const meta = await probeVideoMeta(file, url);
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
      setJobStage({ stage: "Analizando contenido", progress: 30 });

      const metadata = await analyzeVideo(main, (stage, progress) => {
        setJobStage({ stage, progress });
      });
      update({ metadata });
      addLog("Análisis completado");
      setJobStage({ stage: "Listo", progress: 100 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (!project.sources.length) {
      setError("Sube primero un vídeo.");
      return;
    }
    if (!project.metadata) {
      setError("Analiza primero el vídeo.");
      return;
    }
    setError(null);
    setBusy("creating");
    addLog("Creando vídeo automáticamente...");

    try {
      const metadataText = project.metadata.analysisText;
      setJobStage({ stage: "Generando hooks", progress: 10 });
      const hooks = await generateHooks(settings, metadataText);
      if (!hooks.length) throw new Error("No se pudieron generar hooks. Revisa tu clave de LLM.");
      const selectedHook = hooks[0].text;
      update({ hooks, selectedHook });
      addLog(`Hook elegido: "${selectedHook}"`);

      setJobStage({ stage: "Generando guion", progress: 30 });
      const script = await generateScript(
        settings,
        metadataText,
        hooks,
        selectedHook,
        project.style,
        project.goal
      );
      if (!script.length) throw new Error("No se pudo generar el guion.");
      update({ script });
      addLog(`Guion generado (${script.length} bloques)`);

      setJobStage({ stage: "Generando voz", progress: 45 });
      setVoiceStatus("loading");
      const fullText = getScriptFullText({ ...project, script });
      const voice = await generateSpeech(settings, fullText, settings.ttsVoiceId || "alloy", {
        speed: 1,
      });
      const valid = await validateVoiceBlob(voice.url);
      if (!valid) throw new Error("La voz generada no contiene audio válido. Reintenta.");
      update({ voice: { voiceId: settings.ttsVoiceId || "alloy", voiceName: "Voz", provider: settings.ttsProvider, speed: 1, pitch: 1 } });
      setVoiceStatus("done");
      addLog(`Voz generada (${voice.duration.toFixed(1)}s)`);

      setJobStage({ stage: "Generando subtítulos", progress: 60 });
      const cues = await transcribeWithTimestamps(settings, voice.blob);
      if (!cues.length) throw new Error("No se obtuvo transcripción con timestamps.");
      update({ subtitles: { ...project.subtitles, cues } });
      addLog(`Subtítulos: ${cues.length} bloques`);

      setJobStage({ stage: "Generando CTA", progress: 80 });
      const ctas = await generateCta(settings, project.goal);
      setGeneratedCtas(ctas);
      addLog("CTA generado");

      setJobStage({ stage: "Construyendo plan de edición", progress: 90 });
      const withVoice = { ...project, script, subtitles: { ...project.subtitles, cues } };
      const plan = buildEditPlan(withVoice);
      update({ editPlan: plan, status: "ready" });
      addLog("Plan de edición listo");

      setJobStage({ stage: "Listo", progress: 100 });
      addLog("Vídeo creado. Ve al editor para ajustar y exportar.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setVoiceStatus("error");
      addLog(`Error: ${msg}`);
    } finally {
      setBusy(null);
      setJobStage(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const hasMetadata = !!project.metadata;
  const readyToCreate = hasMetadata && project.metadata?.qualityScore;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Crear vídeo</h1>
            <p className="text-sm text-gray-400 mt-1">
              Sube tu vídeo, analízalo y la IA lo convierte en un vídeo vertical completo.
            </p>
          </div>
          {project.id && (
            <div className="flex items-center gap-2 text-xs">
              {statusBadge(project.status)}
            </div>
          )}
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
              <span>{busy === "creating" ? "🤖" : "🔍"} {jobStage.stage}</span>
              <span>{Math.round(jobStage.progress)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-900/50 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${jobStage.progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* FUENTES */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">1. Fuentes</h2>
            <p className="text-xs text-gray-400 mt-1">
              MP4, MOV, WEBM o AVI. Puedes soltar varios archivos.
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
              <span className="text-3xl">📁</span>
              <span className="mt-2 text-sm">Arrastra tu vídeo o haz clic</span>
              <span className="mt-1 text-xs text-gray-400">o selecciona un archivo</span>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>

            {project.sources.map((s) => (
              <div key={s.id} className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 p-2.5">
                <video
                  src={s.url}
                  muted
                  preload="metadata"
                  className="h-14 w-10 rounded object-cover bg-black"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{s.name}</div>
                  <div className="text-xs text-gray-400">
                    {s.width}×{s.height} · {s.duration.toFixed(1)}s
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* ANÁLISIS */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">2. Analizar con IA</h2>
            <p className="text-xs text-gray-400 mt-1">
              Detecta escenas, personas, producto, silencios, ritmo, calidad y audio.
            </p>
            <button
              onClick={() => handleFiles([] as unknown as FileList)}
              disabled={busy !== null || !project.sources.length}
              className={`mt-4 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                busy === "analyzing"
                  ? "bg-blue-600/50 cursor-wait"
                  : project.sources.length
                    ? "bg-blue-600 hover:bg-blue-500"
                    : "bg-white/5 text-gray-400 cursor-not-allowed"
              }`}
            >
              {busy === "analyzing" ? "Analizando…" : hasMetadata ? "Re-analizar" : "Analizar vídeo"}
            </button>

            {project.metadata && (
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Escenas</span>
                  <span>{project.metadata.scenes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Personas</span>
                  <span>{project.metadata.people}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Voz</span>
                  <span>{Math.round(project.metadata.speech * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Calidad</span>
                  <span>{Math.round(project.metadata.qualityScore)}%</span>
                </div>
                <div className="mt-3 rounded-lg bg-white/[0.03] p-3 text-xs text-gray-300 max-h-32 overflow-y-auto">
                  {project.metadata.analysisText}
                </div>
              </div>
            )}
          </section>

          {/* CONFIGURACIÓN DEL VÍDEO */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">3. Configuración</h2>
            <p className="text-xs text-gray-400 mt-1">
              Estilo, objetivo y duración del vídeo final.
            </p>

            <div className="mt-4">
              <span className="text-sm font-medium">Estilo</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VIDEO_STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => update({ style: s.id })}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      project.style === s.id
                        ? "bg-blue-600 text-white"
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <span className="text-sm font-medium">Objetivo</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VIDEO_GOALS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => update({ goal: g.id })}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      project.goal === g.id
                        ? "bg-fuchsia-600 text-white"
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <span className="text-sm font-medium">Duración</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TARGET_DURATIONS.map((d) => (
                  <button
                    key={String(d.id)}
                    onClick={() => update({ targetDuration: d.id })}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      project.targetDuration === d.id
                        ? "bg-emerald-600 text-white"
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
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
          </section>
        </div>

        {/* BOTÓN PRINCIPAL */}
        <div className="mt-8">
          <button
            onClick={handleCreate}
            disabled={busy !== null || !readyToCreate || !project.editPlan}
            className={`w-full rounded-xl px-6 py-4 text-base font-bold transition-colors ${
              busy === "creating"
                ? "bg-fuchsia-600/50 cursor-wait"
                : !readyToCreate
                  ? "bg-white/5 text-gray-400 cursor-not-allowed"
                  : "bg-fuchsia-600 hover:bg-fuchsia-500 shadow-lg shadow-fuchsia-900/40"
            }`}
          >
            {busy === "creating"
              ? "Creando vídeo automáticamente…"
              : project.editPlan
                ? "Regenerar vídeo automáticamente"
                : "Crear vídeo automáticamente"}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Sube → Analiza → Guion → Voz → Subtítulos → Plan de edición. Luego edita cada
            parte o exporta directamente.
          </p>
        </div>

        {/* LOG */}
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
          <a
            href={`/editor?id=${project.id}`}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Abrir en el editor completo →
          </a>
        </div>
      </div>
    </AppShell>
  );
}

async function probeVideoMeta(file: File, url: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const hasAudio =
        typeof (video as unknown as { mozHasAudio?: boolean }).mozHasAudio === "boolean"
          ? (video as unknown as { mozHasAudio?: boolean }).mozHasAudio === true
          : true;
      resolve({
        duration: isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
        fps: 30,
        hasAudio,
      });
    };
    video.onerror = () => reject(new Error("No se pudo leer el vídeo."));
    video.src = url;
  });
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