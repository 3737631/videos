"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSettings } from "@/lib/useStore";
import { DEFAULT_VOICE_BY_LANG, VOICE_CATALOG, formatMB } from "@/lib/voices/catalog";
import { ensureVoiceInstalled, isVoiceInstalled } from "@/lib/voices/engine";
import { storageUsage } from "@/lib/idb";
import { formatSize } from "@/lib/useStore";

const LANGS: Array<{ code: string; label: string; flag: string }> = [
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "en", label: "Inglés", flag: "🇺🇸" },
  { code: "fr", label: "Francés", flag: "🇫🇷" },
  { code: "de", label: "Alemán", flag: "🇩🇪" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Portugués (BR)", flag: "🇧🇷" },
];

export default function ConfiguracionPage() {
  const [settings, update] = useSettings();
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    refresh();
    storageUsage().then(setUsage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const map: Record<string, boolean> = {};
    for (const v of VOICE_CATALOG) map[v.id] = await isVoiceInstalled(v.id);
    setInstalledMap(map);
  }

  const toggleLang = (code: string) => {
    const cur = new Set(settings.preferredLanguages);
    if (cur.has(code)) cur.delete(code);
    else cur.add(code);
    update({ preferredLanguages: [...cur] });
  };

  async function installLanguage(code: string) {
    setBusy(code);
    setError("");
    setPct(null);
    try {
      const id = DEFAULT_VOICE_BY_LANG[code];
      await ensureVoiceInstalled(id, { onProgress: (p) => setPct(p) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setPct(null);
    }
  }

  function voicesOf(code: string) {
    return VOICE_CATALOG.filter((v) => v.locale.toLowerCase().startsWith(code));
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
          <p className="mt-1 text-sm text-gray-400">
            Todo funciona en tu dispositivo y es gratis. Descarga solo los idiomas que uses.
          </p>
        </header>

        <section className="cc-card mb-5 p-5">
          <h2 className="text-sm font-semibold text-gray-200">Descargar voces</h2>
          <p className="mt-1 text-xs text-gray-500">
            Marca tus idiomas y pulsa instalar. Una vez descargadas, las voces están siempre listas
            (sin esperas ni descargas repetidas).
          </p>

          <div className="mt-4 space-y-2">
            {LANGS.map((l) => {
              const vs = voicesOf(l.code);
              const anyInstalled = vs.some((v) => installedMap[v.id]);
              const minBytes = Math.min(...vs.map((v) => v.sizeBytes || Infinity));
              return (
                <div
                  key={l.code}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
                >
                  <button
                    onClick={() => toggleLang(l.code)}
                    aria-pressed={settings.preferredLanguages.includes(l.code)}
                    className={`flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold transition-colors ${
                      settings.preferredLanguages.includes(l.code)
                        ? "border-violet-400 bg-violet-500/80 text-white"
                        : "border-white/20 text-transparent"
                    }`}
                  >
                    ✓
                  </button>
                  <span className="text-lg">{l.flag}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {l.label}
                      <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-gray-400">
                        {vs.length} {vs.length === 1 ? "voz" : "voces"} · desde{" "}
                        {formatMB(Number.isFinite(minBytes) ? minBytes : 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-gray-500">
                      {vs.map((v) => v.name).join(" · ")}
                    </div>
                    {busy === l.code && (
                      <div className="mt-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          {pct === null ? (
                            <div className="cc-shimmer h-full w-full" />
                          ) : (
                            <div className="h-full bg-violet-400 transition-all" style={{ width: `${pct}%` }} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => installLanguage(l.code)}
                    disabled={busy !== null || anyInstalled}
                    className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${
                      anyInstalled
                        ? "cursor-default border border-emerald-400/30 text-emerald-300"
                        : "cc-btn-primary text-white"
                    }`}
                  >
                    {anyInstalled ? "Instalado ✓" : busy === l.code ? "…" : "Instalar"}
                  </button>
                </div>
              );
            })}
          </div>
          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        </section>

        {usage && (
          <section className="cc-card p-5 text-sm">
            <h2 className="font-semibold text-gray-200">Espacio usado por las voces</h2>
            <p className="mt-1 text-gray-400">
              {formatSize(usage.usage)} {usage.quota ? `de ${formatSize(usage.quota)} disponibles` : ""}
            </p>
            <p className="mt-1 text-[11px] text-gray-500">
              Puedes borrar voces concretas en{" "}
              <a href="/videos/voces" className="text-violet-300 hover:text-violet-200">
                Catálogo de voces
              </a>
              .
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}
