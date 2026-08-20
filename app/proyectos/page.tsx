"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProjectActions, formatDuration, formatSize } from "@/lib/useStore";

export default function ProyectosPage() {
  const { projects, deleteProject, duplicateProject } = useProjectActions();

  const sorted = [...projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Mis proyectos</h1>
          <Link
            href="/crear"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
          >
            + Nuevo
          </Link>
        </div>

        {sorted.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-white/15 p-12 text-center text-gray-400">
            No tienes proyectos todavía.
            <div className="mt-3">
              <Link href="/crear" className="text-blue-400 hover:text-blue-300">
                Crea tu primer vídeo →
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {sorted.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-blue-500/40 transition-colors"
              >
                <div className="h-16 w-10 shrink-0 rounded bg-[#131722] flex items-center justify-center overflow-hidden">
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span>🎬</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/editor?id=${p.id}`} className="font-medium hover:text-blue-300 truncate block">
                    {p.name}
                  </Link>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {p.sources.length} fuente(s) · {formatSize(p.sources[0]?.size || 0)} ·{" "}
                    {formatDuration(p.metadata?.duration || 0)} · actualizado{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        p.status === "ready"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : p.status === "processing"
                            ? "bg-blue-500/15 text-blue-300"
                            : p.status === "failed"
                              ? "bg-red-500/15 text-red-300"
                              : "bg-gray-500/15 text-gray-300"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.renderUrl && <span className="text-[11px] text-fuchsia-300">✓ exportado</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/editor?id=${p.id}`}
                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                  >
                    Abrir
                  </Link>
                  <button
                    onClick={() => duplicateProject(p.id)}
                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                  >
                    Duplicar
                  </button>
                  <button
                    onClick={() => deleteProject(p.id)}
                    className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}