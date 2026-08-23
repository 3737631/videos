/**
 * GALERÍA "Mis vídeos" — persistencia real.
 * El blob del vídeo se guarda en IndexedDB (sobrevive a recargas); la metadata
 * ligera (nombre, miniatura en base64, duración…) en localStorage para listar.
 */
import { cachePut, cacheGet } from "@/lib/idb";

export interface ClipMeta {
  id: string;
  name: string;
  thumbnail: string; // dataURL
  duration: number;
  width: number;
  height: number;
  voiceName: string | null;
  musicTrack: string | null;
  cuesCount: number;
  onlyMusic: boolean;
  createdAt: number;
}

const META_KEY = "clipcraft-clips";

function loadMetaList(): ClipMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveMetaList(list: ClipMeta[]): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(list.slice(-50)));
  } catch {}
}

export async function saveClip(meta: ClipMeta, blob: Blob): Promise<void> {
  await cachePut("models", "clip:" + meta.id, { meta, blob });
  const list = loadMetaList().filter((m) => m.id !== meta.id);
  list.unshift(meta);
  saveMetaList(list);
}

export async function getClipBlob(id: string): Promise<Blob | null> {
  const rec = await cacheGet<{ meta: ClipMeta; blob: Blob }>("models", "clip:" + id);
  return rec?.blob ?? null;
}

export function listClips(): ClipMeta[] {
  return loadMetaList();
}

export function deleteClip(id: string): void {
  const list = loadMetaList().filter((m) => m.id !== id);
  saveMetaList(list);
}
