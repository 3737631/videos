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
import { generateHooks, generateScript, transcribeWithTimestamps } from "@/lib/ai";
import { VOICE_CATALOG, generateSpeech, getVoiceById, previewVoice, stopPreview } from "@/lib/tts";
import { serviceStatus } from "@/lib/storage";
import { analyzeVideo } from "@/lib/analyze";
import { detectViralHighlights, type ViralSegment } from "@/lib/viral";
import { loadFfmpeg, isFfmpegLoaded, getFfmpeg } from "@/lib/ffmpeg";
import { renderProject } from "@/lib/render";

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

export default function CrearPage() {
  const { saveProject } = useProjectActions();
  const [settings, setSettings] = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project>(newProject);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"analyzing" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [jobStage, setJobStage] = useState<{ stage: string; progress: number } | null>(null);
  const [voiceMode, setVoiceMode] = useState<"voz" | "musica">("voz");
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

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

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|3gp)$/i.test(f.name)
    );
    if (!list.length) {
      setError("Formato no soportado. Usa MP4, MOV (galería del iPhone), WEBM o AVI.");
      return;
    }
    setError(null);
    setFinalUrl(null);
    setBusy("analyzing");
    setJobStage({ stage: "Leyendo vídeo", progress: 10 });

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
        metadata: null,
      });
      setJobStage({ stage: "Vídeo cargado", progress: 100 });
      addLog(`Vídeo listo: ${main.name}`);
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    const src = project.sources[0];
    if (!src) {
      setError("Sube primero un vídeo.");
      return;
    }
    if (busy !== null) return;
    setError(null);
    setFinalUrl(null);
    setBusy("creating");
    addLog("Creando tu vídeo viral...");

    try {
      // 1. Análisis del contenido
      let meta: VideoMetadata = project.metadata || (null as unknown as VideoMetadata);
      if (!meta) {
        setJobStage({ stage: "Analizando vídeo", progress: 6 });
        try {
          meta = await analyzeVideo(src, (st, p) =>
            setJobStage({ stage: `Analizando: ${st}`, progress: 6 + p * 12 })
          );
          addLog("Análisis completado");
        } catch {
          meta = minimalMetadata(src);
          addLog("Análisis básico aplicado");
        }
      }

      // 2. Momentos virales en TODOS los vídeos subidos
      const nVids = project.sources.length;
      setJobStage({ stage: `Buscando momentos virales (${nVids} vídeo${nVids > 1 ? "s" : ""})`, progress: 12 });
      type Seg = ViralSegment & { si: number };
      const allSegs: Seg[] = [];
      for (let si = 0; si < nVids; si++) {
        const s = project.sources[si];
        try {
          const segs = await detectViralHighlights(s, () => {});
          segs.forEach((g) => allSegs.push({ ...g, si }));
          addLog(`Vídeo ${si + 1}: ${segs.length} momento(s) con gancho`);
        } catch {
          addLog(`Vídeo ${si + 1}: detección omitida`);
        }
      }
      allSegs.sort((a, b) => b.score - a.score);

      // Elegir los mejores: máx 4 momentos, total ≤ 40s
      const picked: Seg[] = [];
      let tot = 0;
      for (const g of allSegs) {
        const d = g.end - g.start;
        if (picked.length >= 4 || tot + d > 40) continue;
        picked.push(g);
        tot += d;
      }
      if (!picked.length) {
        picked.push({ start: 0, end: Math.min(project.sources[0].duration || 15, 20), score: 0.8, si: 0 });
      }
      picked.sort((a, b) => a.si - b.si || a.start - b.start);
      addLog(
        picked.length > 1
          ? `Usando los ${picked.length} mejores momentos (${tot.toFixed(1)}s en total)`
          : "Usando el momento más fuerte"
      );

      // 3. Hooks y guion en inglés
      setJobStage({ stage: "Generando hooks y guion", progress: 24 });
      let hooks: HookOption[] = [];
      try {
        hooks = await generateHooks(settings, meta.analysisText || "Short vertical video.");
      } catch {
        hooks = [];
      }
      if (!hooks.length) hooks = FALLBACK_HOOKS;
      const selectedHook = hooks[0].text;
      let script: ScriptSegment[] = [];
      try {
        script = await generateScript(settings, meta.analysisText || "Short vertical video.", hooks, selectedHook, project.style, project.goal);
      } catch {
        script = [];
      }
      if (!script.length) script = fallbackScript(selectedHook);
      addLog(`Guion listo (${script.length} bloques)`);

      // 4. Voz en inglés (o modo solo música)
      let localVoiceUrl: string | null = null;
      let ttsBlob: Blob | null = null;
      let voiceDuration = 0;
      if (voiceMode === "musica") {
        addLog("Modo solo música: sin voz");
      } else {
        setJobStage({ stage: "Generando voz", progress: 42 });
        if (serviceStatus(settings, "tts").configured) {
          const fullText = getScriptFullText({ ...project, script });
          if (fullText.trim()) {
            try {
              const voice = await generateSpeech(settings, fullText, settings.ttsVoiceId || "alloy", { speed: 1 });
              if (await validateVoiceBlob(voice.url)) {
                ttsBlob = voice.blob;
                localVoiceUrl = voice.url;
                voiceDuration = voice.duration || 0;
                addLog(`Voz generada (${voiceDuration.toFixed(1)}s)`);
              }
            } catch (e) {
              addLog(`Voz omitida: ${errText(e)}`);
            }
          }
        } else {
          addLog("Sin clave TTS: se omite la voz");
        }
      }

      // 5. Subtítulos desde la voz
      let cues: Project["subtitles"]["cues"] = [];
      if (ttsBlob && serviceStatus(settings, "stt").configured) {
        setJobStage({ stage: "Generando subtítulos", progress: 55 });
        try {
          cues = await transcribeWithTimestamps(settings, ttsBlob);
          addLog(`Subtítulos: ${cues.length} bloques`);
        } catch {
          addLog("Subtítulos omitidos");
        }
      }

      // 6. Plan de edición con los momentos virales de todos los vídeos
      setJobStage({ stage: "Preparando edición", progress: 65 });
      const base: Project = {
        ...project,
        metadata: {
          ...meta,
          scenes: picked.map((g) => ({
            start: Math.max(0, g.start),
            end: g.end,
            score: g.score || 0.9,
            type: "action" as const,
            sourceId: project.sources[g.si].id,
          })),
        },
        hooks,
        selectedHook,
        script,
        subtitles: { ...project.subtitles, cues },
        voice: localVoiceUrl ? project.voice : project.voice,
      };
      const plan = buildEditPlan(base);
      if (localVoiceUrl) {
        plan.voice = {
          audioUrl: localVoiceUrl,
          duration: voiceDuration || cues[cues.length - 1]?.end || plan.duration,
          volume: 1,
        };
      }
      const next: Project = { ...base, editPlan: plan, status: "ready" };
      setProject(next);
      saveProject(next);

      // 7. Render final MP4 en el navegador (máxima calidad)
      setJobStage({ stage: "Cargando motor de vídeo (solo la primera vez)", progress: 70 });
      if (!isFfmpegLoaded()) await loadFfmpeg();
      const result = await renderProject(getFfmpeg(), next, {
        targetWidth: 1080,
        targetHeight: 1920,
        fps: 30,
        crf: 18,
        onStage: (st, p) => setJobStage({ stage: `Renderizando: ${st}`, progress: Math.min(99, Math.max(15, p)) }),
      });

      update({ renderUrl: result.url, renderValidation: result.validation, status: "exported" });
      setFinalUrl(result.url);
      setJobStage({ stage: "¡Tu vídeo está listo!", progress: 100 });
      addLog(
        `✅ Vídeo final: ${(result.validation.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${Math.round(result.validation.duration)}s`
      );
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function togglePreview() {
    if (previewing) {
      stopPreview();
      setPreviewing(false);
      return;
    }
    setPreviewing(previewVoice(getVoiceById(settings.ttsVoiceId || "alloy")));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const hasSource = project.sources.length > 0;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Crear vídeo viral</h1>
        <p className="text-sm text-gray-400 mt-1">
          Sube tu vídeo, pulsa el botón y descarga tu vídeo terminado.
        </p>

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
              <span>{busy === "creating" ? "🚀" : "📱"} {jobStage.stage}</span>
              <span>{Math.round(jobStage.progress)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-900/50 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${jobStage.progress}%` }} />
            </div>
          </div>
        )}

        {/* 1 · Subir */}
        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !busy && fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && !busy && fileInput.current?.click()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
              dragging ? "border-blue-500 bg-blue-500/10" : "border-white/15 hover:border-blue-400/50"
            }`}
          >
            <span className="text-3xl">📱</span>
            <span className="mt-2 text-sm">{hasSource ? "Añadir más vídeos" : "Toca para elegir de tu galería"}</span>
            <span className="mt-1 text-xs text-gray-400">Puedes subir varios · MP4 · MOV · WEBM</span>
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
            <div key={s.id} className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
              <video src={s.url} muted playsInline preload="metadata" className="h-14 w-10 rounded object-cover bg-black" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{s.name}</div>
                <div className="text-xs text-gray-400">
                  {s.duration > 0 ? `${s.duration.toFixed(1)}s` : ""}
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* Guía SnapTik */}
        {!hasSource && (
          <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">¿El vídeo es de TikTok?</h2>
            <p className="text-xs text-gray-400 mt-1">
              Descárgalo SIN marca de agua antes de subirlo:
            </p>
            <ol className="mt-3 space-y-1.5 text-xs text-gray-300 list-decimal list-inside">
              <li>En TikTok: pulsa <strong>Compartir → Copiar enlace</strong></li>
              <li>Abre snaptik.me y pega el enlace</li>
              <li>Descarga la opción <strong>"Sin marca de agua"</strong> y súbelo aquí</li>
            </ol>
            <a
              href="https://snaptik.me/es"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
            >
              Abrir SnapTik ↗
            </a>
          </section>
        )}

        {/* Modo audio + selector de voz */}
        {hasSource && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>Audio:</span>
              <button
                onClick={() => setVoiceMode("voz")}
                className={`rounded-full px-3 py-1 transition-colors ${
                  voiceMode === "voz" ? "bg-blue-600 text-white" : "bg-white/10 hover:bg-white/15"
                }`}
              >
                🎙️ Con voz
              </button>
              <button
                onClick={() => setVoiceMode("musica")}
                className={`rounded-full px-3 py-1 transition-colors ${
                  voiceMode === "musica" ? "bg-emerald-600 text-white" : "bg-white/10 hover:bg-white/15"
                }`}
              >
                🎵 Solo música
              </button>
            </div>

            {voiceMode === "voz" && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={settings.ttsVoiceId || "alloy"}
                  onChange={(e) => setSettings({ ttsVoiceId: e.target.value })}
                  className="flex-1 rounded-lg border border-white/15 bg-[#131722] px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  {VOICE_CATALOG.filter((v) => v.language === "English").map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.style}
                    </option>
                  ))}
                </select>
                <button
                  onClick={togglePreview}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    previewing ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
                  }`}
                >
                  {previewing ? "⏹ Parar" : "▶ Escuchar"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* EL BOTÓN ÚNICO */}
        <button
          onClick={handleCreate}
          disabled={busy !== null || !hasSource}
          className={`mt-5 w-full rounded-xl px-6 py-5 text-lg font-bold transition-colors ${
            busy === "creating"
              ? "bg-fuchsia-600/60 cursor-wait animate-pulse-soft"
              : !hasSource
                ? "bg-white/5 text-gray-400 cursor-not-allowed"
                : "bg-fuchsia-600 hover:bg-fuchsia-500 shadow-lg shadow-fuchsia-900/40"
          }`}
        >
          {busy === "creating" ? "Creando tu vídeo viral…" : hasSource && finalUrl ? "🔁 Generar otro vídeo viral" : "🚀 Generar vídeo viral"}
        </button>

        {/* Resultado */}
        {finalUrl && (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="text-sm font-semibold text-emerald-300 mb-3">🎉 ¡Aquí está tu vídeo viral!</div>
            <video src={finalUrl} controls playsInline className="w-full rounded-lg max-h-[60vh] bg-black" />
            <a
              href={finalUrl}
              download={`${project.name || "clip-viral"}.mp4`}
              className="block mt-3 text-center rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold hover:bg-emerald-500"
            >
              ⬇️ Descargar MP4
            </a>
            <Link href={`/editor?id=${project.id}`} className="block mt-2 text-center text-xs text-blue-400 hover:text-blue-300">
              Ajustes avanzados en el editor →
            </Link>
          </div>
        )}

        {log.length > 0 && (
          <details className="mt-6 rounded-xl border border-white/10 p-4">
            <summary className="text-xs text-gray-500 cursor-pointer">Registro de actividad</summary>
            <pre className="mt-2 text-[11px] text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {log.join("\n")}
            </pre>
          </details>
        )}
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
