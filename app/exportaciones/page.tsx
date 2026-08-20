"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProjectActions, formatDuration } from "@/lib/useStore";

export default function ExportacionesPage() {
  const { projects } = useProjectActions();
  const exported = projects
    .flatMap((p) =>
      p.renders.map((r) => ({
        project: p,
        render: r,
        url: p.renderUrl,
        validation: p.renderValidation,
      }))
    )
    .sort((a, b) => b.render.startedAt - a.render.startedAt);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Exportaciones</h1>
        <p className="mt-1 text-sm text-gray-400">
          Historial de renders y archivos exportados.
        </p>

        {exported.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-white/15 p-12 text-center text-gray-400">
            Aún no has exportado ningún vídeo.
            <div className="mt-3">
              <Link href="/crear" className="text-blue-400 hover:text-blue-300">
                Crear y exportar un vídeo →
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {exported.map(({ project, render, url, validation }) => (
              <div
                key={render.id}
                className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="h-16 w-10 shrink-0 rounded bg-[#131722] flex items-center justify-center overflow-hidden">
                  {project.thumbnail ? (
                    <img src={project.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span>🎬</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/editor?id=${project.id}`} className="font-medium hover:text-blue-300 truncate block">
                    {project.name}
                  </Link>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(render.startedAt).toLocaleString()} ·{" "}
                    {validation
                      ? `${formatDuration(validation.duration)} · ${validation.width}×${validation.height} · ${(validation.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                      : render.stage}
                  </div>
                </div>
                {url ? (
                  <a
                    href={url}
                    download={`clipcraft-${project.name}.mp4`}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 shrink-0"
                  >
                    Descargar
                  </a>
                ) : (
                  <span className="text-xs text-gray-400 shrink-0">{render.status}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}