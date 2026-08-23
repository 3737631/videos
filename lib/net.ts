/**
 * Red V3: fetch con timeout real, progreso de descarga y errores humanos.
 * CERO proxies / CERO claves: todo destino es público o local.
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Tiempo agotado (${Math.round(ms / 1000)} s)`);
    this.name = "TimeoutError";
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

/** fetch con timeout duro y abortable. Limpia SIEMPRE el timer. */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30000, ...init } = opts;
  const ctrl = new AbortController();
  const onExternal = init.signal ? () => ctrl.abort((init.signal as AbortSignal).reason) : null;
  init.signal?.addEventListener("abort", onExternal!, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => ctrl.abort(new TimeoutError(timeoutMs)), timeoutMs);
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    if (timer) clearTimeout(timer);
    init.signal?.removeEventListener("abort", onExternal!);
  }
}

/** Descarga binaria con progreso real (bytes) y abort. Devuelve ArrayBuffer. */
export async function fetchBinaryWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ArrayBuffer> {
  const res = await fetchWithTimeout(url, { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 120000 });
  if (!res.ok) throw new Error(`Descarga fallida HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body) return await res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total || loaded);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

/** JSON con timeout */
export async function fetchJsonWithTimeout<T>(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return (await res.json()) as T;
}

const FRIENDLY: Array<[RegExp, string]> = [
  [/abort/i, "Operación cancelada"],
  [/tiempo agotado|timeout/i, "Tardó demasiado. Revisa tu conexión e inténtalo de nuevo."],
  [/failed to fetch|networkerror|load failed/i, "Sin conexión. Comprueba tu red e inténtalo de nuevo."],
  [/404|not found/i, "Recurso no encontrado."],
  [/429|rate.?limit/i, "Demasiadas peticiones. Espera un momento e inténtalo otra vez."],
  [/5\d\d|server/i, "El servidor tuvo un problema. Inténtalo de nuevo en unos segundos."],
];

export function toFriendlyError(err: unknown): string {
  if (!err) return "Algo salió mal.";
  const msg = err instanceof Error ? err.message : String(err);
  if (isAbort(err)) return "Operación cancelada.";
  for (const [re, human] of FRIENDLY) if (re.test(msg)) return human;
  return msg || "Algo salió mal.";
}
