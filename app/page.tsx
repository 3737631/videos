"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useProjects } from "@/lib/useStore";

export default function HomePage() {
  const [script, setScript] = useState("");
  const router = useRouter();
  const [projects] = useProjects();

  const start = () => {
    try {
      sessionStorage.setItem("cc-script-draft", script.trim());
    } catch {}
    router.push("/crear");
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
            Escribe tu guion → voz, música, subtítulos y vídeo listos. Todo en tu dispositivo.
          </p>

          <div className="cc-fade-up cc-fade-up-3 mt-8">
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={6}
              placeholder={"Pega aquí tu guion…\n\nEj: Este gadget convierte tu cocina en el futuro. Cuesta menos de 20€ y hoy tienes envío gratis."}
              className="w-full resize-none rounded-3xl border border-white/12 bg-white/[0.05] px-5 py-4 text-left text-base text-gray-100 placeholder:text-gray-500 outline-none backdrop-blur-md focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/15"
            />
            <button
              onClick={start}
              disabled={!script.trim()}
              className="cc-btn-primary mt-4 w-full rounded-2xl px-8 py-4 text-lg font-bold text-white"
            >
              Generar vídeo ⚡
            </button>
            <p className="mt-3 text-xs text-gray-500">
              ¿Solo música?{" "}
              <Link href="/crear?modo=musica" className="text-violet-300 hover:text-violet-200">
                Prueba el modo solo-música
              </Link>
            </p>
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
