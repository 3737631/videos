"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { formatDuration } from "@/lib/useStore";
import { listClips, getClipBlob, deleteClip, type ClipMeta } from "@/lib/clips";

export default function VideosPage() {
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [active, setActive] = useState<ClipMeta | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    setClips(listClips());
  }, []);

  const openClip = async (c: ClipMeta) => {
    setActive(c);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const blob = await getClipBlob(c.id);
    if (blob) {
      urlRef.current = URL.createObjectURL(blob);
      setActiveUrl(urlRef.current);
    } else {
      setActiveUrl(null);
    }
  };

  const closeClip = () => {
    setActive(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setActiveUrl(null);
  };

  const onDelete = (c: ClipMeta) => {
    deleteClip(c.id);
    setClips(listClips());
    if (active?.id === c.id) closeClip();
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">Mis videos</h1>
          <p className="mt-1 text-sm text-gray-400">
            Los anuncios que has creado. Toca para ver, descargar o eliminar.
          </p>
        </header>

        {clips.length === 0 ? (
          <div className="cc-card flex flex-col items-center gap-4 p-10 text-center">
            <p className="text-sm text-gray-400">Aun no tienes videos.</p>
            <Link href="/crear" className="cc-btn-primary rounded-2xl px-6 py-3 text-sm font-bold text-white">
              Crea tu primer anuncio
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {clips.map((c) => (
              <button key={c.id} onClick={() => openClip(c)} className="cc-card group overflow-hidden text-left">
                <div className="aspect-[9/16] w-full bg-black/40">
                  {c.thumbnail ? (
                    <img src={c.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl text-gray-600">Video</div>
                  )}
                </div>
                <div className="truncate px-2.5 py-2 text-xs text-gray-300">
                  {c.name || "Anuncio"} · {formatDuration(c.duration)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={closeClip}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="cc-card overflow-hidden p-0">
              {activeUrl ? (
                <video src={activeUrl} controls className="w-full bg-black" />
              ) : (
                <div className="aspect-[9/16] w-full bg-black/40" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeUrl && (
                <a href={activeUrl} download className="cc-btn-primary rounded-xl px-4 py-2.5 text-sm font-bold text-white">
                  Descargar
                </a>
              )}
              <button onClick={() => onDelete(active)} className="rounded-xl border border-red-400/40 px-4 py-2.5 text-sm font-medium text-red-200 hover:bg-red-500/10">
                Eliminar
              </button>
              <button onClick={closeClip} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/5">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
