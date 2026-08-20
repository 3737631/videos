"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PRESETS } from "@/lib/presets";

export default function PlantillasPage() {
  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Plantillas</h1>
        <p className="mt-1 text-sm text-gray-400">
          Configuraciones de estilo y objetivo listas para usar.
        </p>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PRESETS.map((p) => (
            <Link
              key={p.id}
              href="/crear"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-5 hover:border-blue-500/40 hover:bg-white/[0.04] transition-colors"
            >
              <div className="text-3xl">{p.emoji}</div>
              <div className="mt-3 text-lg font-semibold">{p.name}</div>
              <p className="mt-1 text-sm text-gray-400">{p.description}</p>
              <div className="mt-3 flex gap-1.5">
                <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                  {p.style}
                </span>
                <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                  {p.goal}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}