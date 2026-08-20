"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useProjectActions, useSettings, formatDuration } from "@/lib/useStore";
import type { Project, RenderValidation } from "@/types";
import { buildEditPlan } from "@/lib/editplan";
import { renderProject } from "@/lib/render";
import { loadFfmpeg, isFfmpegLoaded, getFfmpeg } from "@/lib/ffmpeg";
import { EXPORT_TARGETS } from "@/lib/presets";
import { jobs } from "@/lib/jobs";

type Tab = "preview" | "script" | "voice" | "subtitles" | "timeline" | "export";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "preview", label: "Vista previa", icon: "🎬" },
  { id: "script", label: "Guion", icon: "📝" },
  { id: "voice", label: "Voz", icon: "🎙️" },
  { id: "subtitles", label: "Subtítulos", icon: "💬" },
  { id: "timeline", label: "Línea de tiempo", icon: "⏱️" },
  { id: "export", label: "Exportar", icon: "📤" },
];

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="text-center text-gray-400">Cargando editor…</div>
          </div>
        </AppShell>
      }
    >
      <EditorInner />
    </Suspense>
  );
}

function EditorInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const { getProject, saveProject } = useProjectActions();
  const project = id ? getProject(id) : null;
  const [tab, setTab] = useState<Tab>("preview");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [exportResult, setExportResult] = useState<{ url: string; validation: RenderValidation } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [settings] = useSettings();

  useEffect(() => {
    if (project?.renderUrl) setExportResult({ url: project.renderUrl, validation: project.renderValidation! });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!project) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-6 py-20 text-center">
          <h1 className="text-2xl font-bold">Proyecto no encontrado</h1>
          <p className="mt-2 text-gray-400">Selecciona un proyecto desde Inicio o Mis proyectos.</p>
        </div>
      </AppShell>
    );
  }

  const current = project as Project;
  function update(patch: Partial<Project>) {
    saveProject({ ...current, ...patch });
  }

  async function handleRender(target: { id: string; w: number; h: number; fps: number }) {
    setError(null);
    setExportResult(null);
    setRendering(true);
    setRenderProgress({ stage: "Cargando FFmpeg", progress: 0 });
    try {
      if (!isFfmpegLoaded()) {
        setRenderProgress({ stage: "Descargando FFmpeg (solo la primera vez)", progress: 5 });
        await loadFfmpeg();
      }
      const job = jobs.create(current.id, "render", async (updateJob) => {
        const result = await renderProject(
          getFfmpeg(),
          { ...current, editPlan: current.editPlan || buildEditPlan(current) },
          {
            targetWidth: target.w,
            targetHeight: target.h,
            fps: target.fps,
            crf: 23,
            onStage: (stage, progress) => updateJob(stage, progress),
          }
        );
        setExportResult({ url: result.url, validation: result.validation });
        update({ renderUrl: result.url, renderValidation: result.validation, status: "exported" });
        return () => {};
      });
      setRenderProgress({ stage: "Renderizando…", progress: 10 });
      jobs.subscribe((list) => {
        const j = list.find((x) => x.id === job.id);
        if (j && j.status === "failed") {
          setError(j.error || "El render falló.");
          setRendering(false);
        }
        if (j && j.status === "done") {
          setRendering(false);
          setRenderProgress(null);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRendering(false);
      setRenderProgress(null);
    }
  }

  function handlePreview() {
    videoRef.current?.play();
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <div className="text-xs text-gray-400 mt-1 flex items-center gap-3">
              <span>{project.sources.length} fuente(s)</span>
              <span>{project.style}</span>
              <span>{project.goal}</span>
              <span>{formatDuration(project.metadata?.duration || 0)}</span>
            </div>
          </div>
          <a href="/" className="text-sm text-blue-400 hover:text-blue-300">← Inicio</a>
        </div>

        <div className="mt-6 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                tab === t.id
                  ? "bg-blue-600 text-white"
                  : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              <span aria-hidden className="mr-1">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {renderProgress && (
          <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex justify-between text-sm text-blue-200">
              <span>🎬 {renderProgress.stage}</span>
              <span>{Math.round(renderProgress.progress)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-900/50 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${renderProgress.progress}%` }} />
            </div>
          </div>
        )}

        {exportResult && (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-emerald-200">
                ✅ Exportado correctamente · {formatDuration(exportResult.validation.duration)} ·{" "}
                {exportResult.validation.width}×{exportResult.validation.height} ·{" "}
                {(exportResult.validation.sizeBytes / 1024 / 1024).toFixed(1)} MB
              </div>
              <a
                href={exportResult.url}
                download={`clipcraft-${project.name}.mp4`}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
              >
                Descargar MP4
              </a>
            </div>
          </div>
        )}

        <div className="mt-6">
          {tab === "preview" && (
            <PreviewTab project={project} videoRef={videoRef} onPlay={handlePreview} />
          )}
          {tab === "script" && (
            <ScriptTab project={project} onUpdate={update} />
          )}
          {tab === "voice" && (
            <VoiceTab project={project} onUpdate={update} />
          )}
          {tab === "subtitles" && (
            <SubtitlesTab project={project} onUpdate={update} />
          )}
          {tab === "timeline" && (
            <TimelineTab project={project} onUpdate={update} />
          )}
          {tab === "export" && (
            <ExportTab
              project={project}
              rendering={rendering}
              renderProgress={renderProgress}
              onRender={handleRender}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PreviewTab({
  project,
  videoRef,
  onPlay,
}: {
  project: Project;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPlay: () => void;
}) {
  const src = project.renderUrl || project.sources[0]?.url;
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="w-full lg:w-1/2 rounded-xl border border-white/10 bg-black overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          src={src}
          controls
          className="w-full max-h-[70vh] object-contain"
          preload="metadata"
        />
      </div>
      <div className="w-full lg:w-1/2 space-y-4">
        <div className="rounded-xl border border-white/10 p-4">
          <h3 className="font-semibold">Información del proyecto</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-gray-400">Fuente</dt><dd>{project.sources[0]?.name}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Estilo</dt><dd>{project.style}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Objetivo</dt><dd>{project.goal}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Duración objetivo</dt><dd>{project.targetDuration}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Escenas</dt><dd>{project.metadata?.scenes.length || 0}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Calidad</dt><dd>{project.metadata ? Math.round(project.metadata.qualityScore) + "%" : "—"}</dd></div>
          </dl>
          {!project.renderUrl && (
            <button
              onClick={onPlay}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
            >
              ▶ Reproducir fuente
            </button>
          )}
        </div>
        {!project.renderUrl && (
          <div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-gray-400">
            Aún no has exportado. Ve a la pestaña <strong>Exportar</strong> para generar el
            vídeo final 9:16 con voz, subtítulos y música.
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptTab({ project, onUpdate }: { project: Project; onUpdate: (p: Partial<Project>) => void }) {
  const kinds = ["hook", "desarrollo", "beneficio", "prueba", "cta"] as const;
  const labels: Record<string, string> = {
    hook: "HOOK",
    desarrollo: "DESARROLLO",
    beneficio: "BENEFICIO",
    prueba: "PRUEBA",
    cta: "CTA",
  };
  if (!project.script.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-gray-400">
        Aún no hay guion. Vuelve a "Crear vídeo" y genera el vídeo automáticamente.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Guion</h3>
        <span className="text-xs text-gray-400">{project.script.reduce((a, s) => a + s.text.split(/\s+/).length, 0)} palabras</span>
      </div>
      <div className="mt-4 space-y-3">
        {project.script.map((seg, i) => (
          <div key={i} className="rounded-lg bg-white/[0.03] p-3">
            <span className="text-xs font-bold text-blue-400">{labels[seg.kind]}</span>
            <textarea
              value={seg.text}
              onChange={(e) => {
                const script = [...project.script];
                script[i] = { ...seg, text: e.target.value };
                onUpdate({ script });
              }}
              rows={2}
              className="mt-2 w-full rounded-lg border border-white/15 bg-[#131722] px-3 py-2 text-sm outline-none focus:border-blue-500 resize-y"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function VoiceTab({ project, onUpdate }: { project: Project; onUpdate: (p: Partial<Project>) => void }) {
  const audioUrl = project.editPlan?.voice?.audioUrl;
  if (!audioUrl) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-gray-400">
        No hay voz generada todavía. Genera el vídeo automáticamente para crear la locución.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Voz generada</h3>
        <span className="text-xs text-gray-400">
          {project.voice?.provider} · {project.voice?.voiceName}
        </span>
      </div>
      <audio src={audioUrl} controls className="mt-4 w-full" />
      <div className="mt-4">
        <label className="text-sm">Velocidad: <strong>{project.voice?.speed ?? 1}x</strong></label>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={project.voice?.speed ?? 1}
          onChange={(e) => {
            const speed = Number(e.target.value);
            onUpdate({ voice: { ...project.voice!, speed } });
          }}
          className="mt-2 w-full"
        />
      </div>
      <p className="mt-3 text-xs text-gray-400">
        La velocidad se aplica al generar la locución. Para cambiarla, regenera el vídeo con
        una velocidad distinta.
      </p>
    </div>
  );
}

function SubtitlesTab({ project, onUpdate }: { project: Project; onUpdate: (p: Partial<Project>) => void }) {
  const cues = project.subtitles.cues;
  if (!cues.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-gray-400">
        No hay subtítulos. Genera el vídeo automáticamente para crear subtítulos con
        timestamps palabra por palabra.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Subtítulos ({cues.length} bloques)</h3>
        <span className="text-xs text-gray-400">Tamaño: {project.subtitles.style.size}px</span>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
          {cues.map((c, i) => (
            <div key={i} className="rounded-lg bg-white/[0.03] p-3">
              <div className="text-[11px] text-gray-400">
                {formatDuration(c.start)} → {formatDuration(c.end)}
              </div>
              <div className="mt-1 text-sm">{c.text}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-white/10 p-4">
          <h4 className="text-sm font-medium">Estilo</h4>
          <label className="mt-3 block text-xs text-gray-400">Tamaño</label>
          <input
            type="range"
            min={40}
            max={120}
            value={project.subtitles.style.size}
            onChange={(e) =>
              onUpdate({
                subtitles: {
                  ...project.subtitles,
                  style: { ...project.subtitles.style, size: Number(e.target.value) },
                },
              })
            }
            className="w-full"
          />
          <label className="mt-3 block text-xs text-gray-400">Color activo</label>
          <input
            type="color"
            value={project.subtitles.style.activeColor}
            onChange={(e) =>
              onUpdate({
                subtitles: {
                  ...project.subtitles,
                  style: { ...project.subtitles.style, activeColor: e.target.value },
                },
              })
            }
            className="mt-1 h-9 w-full cursor-pointer"
          />
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              id="shadow"
              checked={project.subtitles.style.shadow}
              onChange={(e) =>
                onUpdate({
                  subtitles: {
                    ...project.subtitles,
                    style: { ...project.subtitles.style, shadow: e.target.checked },
                  },
                })
              }
            />
            <label htmlFor="shadow">Sombra</label>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ project }: { project: Project; onUpdate: (p: Partial<Project>) => void }) {
  const plan = project.editPlan;
  const meta = project.metadata;
  const total = meta?.duration || plan?.duration || 0;
  const cues = project.subtitles.cues;
  return (
    <div className="rounded-xl border border-white/10 p-5">
      <h3 className="font-semibold">Línea de tiempo</h3>
      <div className="mt-4 space-y-2">
        <Track name="VIDEO" color="bg-blue-600" length={total}>
          <div className="h-full rounded bg-blue-600/70" style={{ width: "100%" }} />
        </Track>
        <Track name="VOZ" color="bg-fuchsia-500" length={total}>
          {cues.map((c, i) => (
            <div
              key={i}
              className="h-full rounded bg-fuchsia-500/70"
              style={{
                left: `${(c.start / Math.max(total, 1)) * 100}%`,
                width: `${((c.end - c.start) / Math.max(total, 1)) * 100}%`,
              }}
            />
          ))}
        </Track>
        <Track name="SUBTÍTULOS" color="bg-emerald-500" length={total}>
          {cues.map((c, i) => (
            <div
              key={i}
              className="h-full rounded bg-emerald-500/70"
              style={{
                left: `${(c.start / Math.max(total, 1)) * 100}%`,
                width: `${((c.end - c.start) / Math.max(total, 1)) * 100}%`,
              }}
            />
          ))}
        </Track>
        <Track name="MÚSICA" color="bg-amber-500" length={total}>
          {project.music && (
            <div className="h-full rounded bg-amber-500/70" style={{ width: "100%" }} />
          )}
        </Track>
        <Track name="AUDIO ORIGINAL" color="bg-gray-500" length={total}>
          <div className="h-full rounded bg-gray-500/60" style={{ width: "100%" }} />
        </Track>
      </div>
      <p className="mt-4 text-xs text-gray-400">
        {total.toFixed(1)}s · {cues.length} bloques de subtítulos ·{" "}
        {plan?.clips.length || 0} clips de edición
      </p>
    </div>
  );
}

function Track({
  name,
  color,
  length,
  children,
}: {
  name: string;
  color: string;
  length: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-28 shrink-0 text-xs font-medium ${color} text-white text-center rounded px-1 py-0.5`}>
        {name}
      </span>
      <div className="relative flex-1 h-6 rounded bg-white/[0.04] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function ExportTab({
  project,
  rendering,
  renderProgress,
  onRender,
}: {
  project: Project;
  rendering: boolean;
  renderProgress: { stage: string; progress: number } | null;
  onRender: (target: { id: string; w: number; h: number; fps: number }) => void;
}) {
  const [selected, setSelected] = useState("tiktok");
  const target = EXPORT_TARGETS.find((t) => t.id === selected) || EXPORT_TARGETS[0];
  return (
    <div className="rounded-xl border border-white/10 p-5">
      <h3 className="font-semibold">Exportar vídeo vertical</h3>
      <p className="mt-1 text-sm text-gray-400">
        Formato MP4 · H.264 + AAC · 9:16. El render se ejecuta en tu navegador con FFmpeg.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {EXPORT_TARGETS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${
              selected === t.id
                ? "bg-blue-600 text-white"
                : "bg-white/5 text-gray-300 hover:bg-white/10"
            }`}
          >
            {t.label}
            <span className="ml-1 text-xs opacity-70">{t.w}×{t.h}</span>
          </button>
        ))}
      </div>
      <button
        onClick={() => onRender(target)}
        disabled={rendering || !project.editPlan}
        className={`mt-5 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
          rendering
            ? "bg-blue-600/50 cursor-wait"
            : project.editPlan
              ? "bg-blue-600 hover:bg-blue-500"
              : "bg-white/5 text-gray-400 cursor-not-allowed"
        }`}
      >
        {rendering
          ? `Renderizando… ${renderProgress ? `${Math.round(renderProgress.progress)}%` : ""}`
          : "Exportar MP4"}
      </button>
      <p className="mt-3 text-xs text-gray-400">
        La primera vez se descarga el motor FFmpeg (~31 MB). Los renders posteriores son
        locales y sin espera de servidor.
      </p>
    </div>
  );
}