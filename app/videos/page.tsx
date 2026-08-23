"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProjects, formatDuration } from "@/lib/useStore";

export default function VideosPage() {
  const [projects] = useProjects();

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Mis vídeos</h1>
          <p className="mt-1 text-sm text-gray-400">
            Los anuncios que has creado. Toca para descargar o volver a crear.
          </p>
        </header>

        {projects.length === 0 ? (
          <div className="cc-card flex flex-col items-center gap-4 p-10 text-center">
            <span className="text-5xl">🎬</span>
            <p className="text-sm text-gray-400">Aún no tienes vídeos.</p>
            <Link
              href="/crear"
              className="cc-btn-primary rounded-2xl px-6 py-3 text-sm font-bold text-white"
            >
              Crea tu primer anuncio
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/crear?p=${p.id}`} className="cc-card group overflow-hidden">
                <div className="aspect-[9/16] w-full bg-black/40">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl">🎬</div>
                  )}
                </div>
                <div className="truncate px-2.5 py-2 text-xs text-gray-300">
                  {p.name || "Anuncio"} · {formatDuration(p.metadata?.duration ?? 0)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
