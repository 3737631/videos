"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useProjects } from "@/lib/useStore";

export default function HomePage() {
  const [link, setLink] = useState("");
  const router = useRouter();
  const [projects] = useProjects();

  const goLink = () => {
    const u = link.trim();
    if (!u) return;
    router.push(`/crear?url=${encodeURIComponent(u)}`);
  };

  return (
    <AppShell>
      <div className="relative overflow-hidden">
        <div className="cc-hero-glow" />
        <section className="relative mx-auto max-w-3xl px-5 pt-14 pb-10 text-center">
          <div className="cc-fade-up inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-gray-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            100% gratis · sin claves · funciona offline
          </div>

          <h1 className="cc-fade-up cc-fade-up-1 mt-6 text-[2.6rem] leading-[1.08] font-extrabold tracking-tight sm:text-6xl">
            <span className="cc-gradient-text">ClipCraft</span>
          </h1>
          <p className="cc-fade-up cc-fade-up-1 mt-3 text-xl font-semibold text-gray-200 sm:text-2xl">
            Crea anuncios virales en segundos.
          </p>
          <p className="cc-fade-up cc-fade-up-2 mt-2 text-sm text-gray-400 sm:text-base">
            Producto o vídeo → guion, voz, música, subtítulos y render. Todo en tu dispositivo.
          </p>

          <div className="cc-fade-up cc-fade-up-3 mx-auto mt-8 max-w-md space-y-4 text-left">
            {/* A · Enlace de AliExpress */}
            <div className="rounded-3xl border border-white/12 bg-white/[0.05] p-4 backdrop-blur-md">
              <label className="text-sm font-semibold text-gray-100">🔗 Enlace de AliExpress</label>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && goLink()}
                placeholder="Pega aquí el enlace…"
                inputMode="url"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/10"
              />
              <button
                onClick={goLink}
                disabled={!link.trim()}
                className="cc-btn-primary mt-3 w-full rounded-xl px-6 py-3 text-sm font-bold text-white disabled:opacity-40"
              >
                Analizar producto →
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-600">
              <span className="h-px flex-1 bg-white/10" /> O <span className="h-px flex-1 bg-white/10" />
            </div>

            {/* B · Subir vídeos */}
            <button
              onClick={() => router.push("/crear")}
              className="block w-full rounded-3xl border border-white/12 bg-white/[0.05] p-4 backdrop-blur-md transition-colors hover:border-violet-400/40"
            >
              <span className="block text-left text-sm font-semibold text-gray-100">🎥 Subir vídeos</span>
              <span className="mt-1 block text-left text-xs text-gray-500">
                Usa tus propios clips como base del anuncio
              </span>
            </button>
          </div>
        </section>

        {projects.length > 0 && (
          <section className="mx-auto max-w-3xl px-5 pb-16">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">Tus vídeos</h2>
              <Link href="/proyectos" className="text-xs text-violet-300 hover:text-violet-200">
                Ver todos
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {projects.slice(0, 4).map((p) => (
                <Link key={p.id} href={`/editor?id=${p.id}`} className="cc-card group overflow-hidden">
                  <div className="aspect-[9/16] max-h-40 w-full bg-black/40">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-2xl">🎬</div>
                    )}
                  </div>
                  <div className="truncate px-2.5 py-2 text-xs text-gray-300">{p.name}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
