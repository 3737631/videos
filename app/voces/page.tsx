"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VOICE_CATALOG, formatMB, type CatalogVoice } from "@/lib/voices/catalog";
import { deleteVoice, ensureVoiceInstalled, isVoiceInstalled, synthesize } from "@/lib/voices/engine";
import Link from "next/link";

type Status = "idle" | "downloading" | "installed" | "previewing" | "error";

export default function VocesPage() {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [pcts, setPcts] = useState<Record<string, number | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, Status> = {};
      for (const v of VOICE_CATALOG) {
        next[v.id] = (await isVoiceInstalled(v.id)) ? "installed" : "idle";
      }
      if (alive) setStatus(next);
    })();
    return () => {
      alive = false;
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAudio() {
    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  async function download(v: CatalogVoice) {
    setErrors((e) => ({ ...e, [v.id]: "" }));
    setStatus((s) => ({ ...s, [v.id]: "downloading" }));
    setPcts((p) => ({ ...p, [v.id]: v.runtime === "kokoro" ? null : 0 }));
    try {
      await ensureVoiceInstalled(v.id, {
        onProgress: (pct) => setPcts((p) => ({ ...p, [v.id]: pct })),
      });
      setStatus((s) => ({ ...s, [v.id]: "installed" }));
      setPcts((p) => ({ ...p, [v.id]: 100 }));
    } catch (err) {
      setStatus((s) => ({ ...s, [v.id]: "error" }));
      setErrors((e) => ({ ...e, [v.id]: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function preview(v: CatalogVoice) {
    stopAudio();
    setStatus((s) => ({ ...s, [v.id]: "previewing" }));
    try {
      const res = await synthesize(v.sampleText, v.id);
      urlRef.current = URL.createObjectURL(res.blob);
      const a = new Audio(urlRef.current);
      audioRef.current = a;
      a.onended = () => {
        stopAudio();
        setStatus((s) => ({ ...s, [v.id]: "installed" }));
      };
      await a.play();
    } catch {
      setStatus((s) => ({ ...s, [v.id]: "installed" }));
    }
  }

  async function remove(v: CatalogVoice) {
    stopAudio();
    await deleteVoice(v.id);
    setStatus((s) => ({ ...s, [v.id]: "idle" }));
    setPcts((p) => ({ ...p, [v.id]: null }));
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Catálogo de voces</h1>
          <p className="mt-1 text-sm text-gray-400">
            Voces locales y gratuitas. Se descargan una vez y quedan guardadas en tu dispositivo.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            ¿Aún no tienes tu guion?{" "}
            <Link href="/" className="text-violet-300 hover:text-violet-200">
              Empieza en la página principal
            </Link>
          </p>
        </header>

        <div className="space-y-3">
          {VOICE_CATALOG.map((v) => {
            const st = status[v.id] ?? "idle";
            const pct = pcts[v.id];
            return (
              <article key={v.id} className="cc-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg">{v.flag}</span>
                      <h2 className="text-base font-bold">{v.name}</h2>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                        {v.gender === "femenina" ? "Femenina" : "Masculina"} · {v.country}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{v.style}</p>
                    <p className="mt-1 text-xs italic text-gray-500">“{v.sampleText}”</p>
                  </div>
                </div>

                {(st === "downloading") && (
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-white/8">
                      {pct === null ? (
                        <div className="cc-shimmer h-full w-full" />
                      ) : (
                        <div
                          className="h-full transition-all"
                          style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8B7CFF,#22D3EE)" }}
                        />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {pct === null ? "Preparando descarga…" : `Descargando… ${pct}%`}
                    </p>
                  </div>
                )}

                {errors[v.id] && (
                  <p className="mt-3 text-xs text-red-300">{errors[v.id]}</p>
                )}

                <div className="mt-4 flex items-center gap-2">
                  {st === "installed" || st === "previewing" ? (
                    <>
                      <button
                        onClick={() => preview(v)}
                        disabled={st === "previewing"}
                        className="cc-btn-primary rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {st === "previewing" ? "Generando…" : "▶ Escuchar"}
                      </button>
                      <button
                        onClick={() => remove(v)}
                        className="rounded-xl border border-white/12 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
                      >
                        Borrar
                      </button>
                      <span className="ml-auto text-[11px] text-emerald-300">En tu dispositivo</span>
                    </>
                  ) : st === "downloading" ? (
                    <span className="text-xs text-gray-400">Una sola descarga · {formatMB(v.sizeBytes)}</span>
                  ) : (
                    <>
                      <button
                        onClick={() => download(v)}
                        className="cc-btn-primary rounded-xl px-4 py-2 text-sm font-semibold text-white"
                      >
                        Descargar voz{v.runtime === "kokoro" && v.sizeBytes > 0 ? ` · ${formatMB(v.sizeBytes)}` : ""}
                      </button>
                      {v.runtime === "kokoro" && v.sizeBytes === 0 && (
                        <span className="text-[11px] text-gray-500">comparte el modelo inglés</span>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
