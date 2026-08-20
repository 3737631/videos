"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProjects } from "@/lib/useStore";
import { PRESETS } from "@/lib/presets";

export default function HomePage() {
  const [projects] = useProjects();
  const recent = projects.slice(0, 4);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-600/20 via-transparent to-fuchsia-600/10 p-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Vídeo vertical con IA, listo en minutos.
          </h1>
          <p className="mt-2 text-gray-300 max-w-xl">
            Sube tu vídeo, la IA lo analiza, genera el guion, la voz, los subtítulos y la
            edición automática. Exporta en 9:16 para TikTok, Reels y Shorts.
          </p>
          <div className="mt-6 flex gap-3">
            <Link
              href="/crear"
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold hover:bg-blue-500 transition-colors"
            >
              Crear vídeo
            </Link>
            <Link
              href="/plantillas"
              className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/5 transition-colors"
            >
              Ver plantillas
            </Link>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Proyectos recientes</h2>
            <Link href="/proyectos" className="text-sm text-blue-400 hover:text-blue-300">
              Ver todos
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-white/15 p-10 text-center text-gray-400">
              Aún no tienes proyectos. Sube tu primer vídeo para empezar.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              {recent.map((p) => (
                <Link
                  key={p.id}
                  href={`/editor?id=${p.id}`}
                  className="group rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden hover:border-blue-500/40 transition-colors"
                >
                  <div className="aspect-video bg-[#131722] flex items-center justify-center text-3xl">
                    {p.thumbnail ? (
                      <img
                        src={p.thumbnail}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>🎬</span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{p.status}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Plantillas</h2>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            {PRESETS.slice(0, 4).map((p) => (
              <Link
                key={p.id}
                href="/crear"
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-blue-500/40 hover:bg-white/[0.04] transition-colors"
              >
                <div className="text-2xl">{p.emoji}</div>
                <div className="mt-2 font-medium">{p.name}</div>
                <div className="mt-1 text-xs text-gray-400">{p.description}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}