/**
 * CACHE PERMANENTE (IndexedDB) — arquitectura V3:
 *   CATÁLOGO → CACHE (esta BD) → MODELO → AUDIO
 * Almacenes:
 *   voices     {config, onnx} por voz (Piper)          → descarga UNA vez
 *   models     binarios de runtime (ort / phonemize)   → descarga UNA vez
 *   audioCache WAV ya generados (hash texto+voz)       → instantáneo tras 1ª vez
 * Sin IndexedDB (SSR/tests): backend en memoria con la misma interfaz.
 */

const DB_NAME = "clipcraft-v3";
const DB_VERSION = 1;
export type StoreName = "voices" | "models" | "audioCache";

interface MemEntry {
  value: unknown;
}
const mem: Record<StoreName, Map<string, MemEntry>> = {
  voices: new Map(),
  models: new Map(),
  audioCache: new Map(),
};

function hasIDB(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("voices")) db.createObjectStore("voices");
        if (!db.objectStoreNames.contains("models")) db.createObjectStore("models");
        if (!db.objectStoreNames.contains("audioCache")) db.createObjectStore("audioCache");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("No se pudo abrir el almacenamiento local"));
    });
  }
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function cacheGet<T>(store: StoreName, key: string): Promise<T | null> {
  if (!hasIDB()) {
    const e = mem[store].get(key);
    return e ? (e.value as T) : null;
  }
  try {
    const v = await tx<T>(store, "readonly", (s) => s.get(key));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function cachePut(store: StoreName, key: string, value: unknown): Promise<void> {
  if (!hasIDB()) {
    mem[store].set(key, { value });
    return;
  }
  await tx(store, "readwrite", (s) => s.put(value, key));
}

export async function cacheDel(store: StoreName, key: string): Promise<void> {
  if (!hasIDB()) {
    mem[store].delete(key);
    return;
  }
  await tx(store, "readwrite", (s) => s.delete(key));
}

export async function cacheKeys(store: StoreName): Promise<string[]> {
  if (!hasIDB()) return [...mem[store].keys()];
  try {
    const keys = await tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys());
    return keys.map(String);
  } catch {
    return [];
  }
}

/** Voz Piper instalada → metadatos ligeros para UI */
export interface InstalledVoiceInfo {
  voiceId: string;
  bytes: number;
  savedAt: number;
}

export async function listInstalledVoices(): Promise<InstalledVoiceInfo[]> {
  if (!hasIDB()) {
    return [...mem.voices.entries()].map(([voiceId, e]) => {
      const v = e.value as { size?: number; savedAt?: number };
      return { voiceId, bytes: v?.size ?? 0, savedAt: v?.savedAt ?? 0 };
    });
  }
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const out: InstalledVoiceInfo[] = [];
      const t = db.transaction("voices", "readonly");
      const cur = t.objectStore("voices").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        const v = c.value as { size?: number; savedAt?: number };
        out.push({ voiceId: String(c.key), bytes: v?.size ?? 0, savedAt: v?.savedAt ?? 0 });
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  } catch {
    return [];
  }
}

export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Hash estable corto para claves de audioCache */
export function hashKey(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + s.charCodeAt(i) * (i + 7), 2654435761);
  }
  return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
}
