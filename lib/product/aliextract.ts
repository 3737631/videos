/**
 * EXTRACCIÓN DE PRODUCTO ALIEXPRESS (best-effort, nunca bloquea).
 * · parseAliUrl: valida y extrae el ID de ítem (puro, testeable).
 * · extractFromMarkdown: parsea texto/plano del producto (puro, testeable).
 * · fetchProduct: intento directo → lector público r.jina.ai (sin claves).
 *   Si algo falla se registra en `missing` y la app CONTINÚA.
 */

export interface ProductInfo {
  url: string;
  itemId: string | null;
  title: string | null;
  price: string | null;
  currency: string | null;
  images: string[];
  videoUrls: string[];
  seller: string | null;
  description: string | null;
  features: string[];
}

export interface ProductFetchResult {
  info: ProductInfo;
  missing: string[];
  source: "direct" | "reader" | "none";
}

export function emptyProduct(url: string): ProductInfo {
  return {
    url,
    itemId: null,
    title: null,
    price: null,
    currency: null,
    images: [],
    videoUrls: [],
    seller: null,
    description: null,
    features: [],
  };
}

const ID_RE =
  /(?:\/item\/|itemId=|\bid=)(\d{6,25})/i;

/** Valida host AliExpress y extrae el ID numérico del ítem. */
export function parseAliUrl(raw: string): { itemId: string; normalized: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/aliexpress\.(com|[a-z.]+)$/i.test(u.hostname) && !/ali\.express/i.test(u.hostname)) {
    return null;
  }
  const m = raw.match(ID_RE) || `${u.pathname}${u.search}`.match(ID_RE);
  const itemId = m?.[1] ?? null;
  if (!itemId) return null;
  const normalized = `https://es.aliexpress.com/item/${itemId}.html`;
  return { itemId, normalized };
}

function absolutize(src: string, base: string): string | null {
  try {
    const abs = new URL(src, base).toString();
    return /^https?:/.test(abs) ? abs : null;
  } catch {
    return null;
  }
}

const PRICE_RE = /(US\s*\$|\$\s*|€\s*|EUR\s*)(\d{1,4}(?:[.,]\d{1,2})?)/;

/** Parser puro de markdown/texto plano de página de producto. */
export function extractFromMarkdown(md: string, baseUrl: string): ProductInfo {
  const info = emptyProduct(baseUrl);
  info.itemId = parseAliUrl(baseUrl)?.itemId ?? null;

  // Título: primera cabecera # o línea "Title:"
  const h1 = md.match(/^#\s+(.{6,180})$/m);
  const titleTag = md.match(/^Title:\s*(.+)$/m);
  const meta = md.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{6,200})["']/i);
  info.title = (titleTag?.[1] || h1?.[1] || meta?.[1] || "").trim() || null;

  // Precio
  const pm = md.match(PRICE_RE);
  if (pm) {
    info.currency = pm[1].includes("€") ? "EUR" : "USD";
    info.price = pm[2].replace(",", ".");
  }

  // Imágenes CDN de AliExpress
  const imgRe = /https?:\/\/[^\s"'()]*?ae-pic\.alicdn\.com[^\s"'()]*?\.(?:jpe?g|png|webp)[^\s"'()]*/gi;
  const seen = new Set<string>();
  for (const m of md.matchAll(imgRe)) {
    const clean = absolutize(m[0].replace(/&amp;/g, "&"), baseUrl);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      info.images.push(clean);
      if (info.images.length >= 12) break;
    }
  }

  // Vídeos embebidos (.mp4 conocidos de AliExpress)
  const vidRe = /https?:\/\/[^\s"'())]+\.mp4[^\s"'())]*/gi;
  for (const m of md.matchAll(vidRe)) {
    const v = m[0];
    if (/aliexpress|alicdn|alibaba/i.test(v)) info.videoUrls.push(v.replace(/&amp;/g, "&"));
  }

  // Vendedor
  const seller = md.match(/Store:\s*(.{2,80})/m) || md.match(/Tienda:\s*(.{2,80})/m);
  info.seller = seller?.[1]?.trim() || null;

  // Descripción corta
  const desc =
    md.match(/(?:Description|Descripción|Descripcion):\s*\n?([\s\S]{20,600}?)(?:\n#|\n\n\n|$)/i);
  info.description = desc?.[1]?.trim().slice(0, 500) ?? null;

  // Características con viñeta
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (/^[-*•]\s+.{8,120}$/.test(t)) info.features.push(t.replace(/^[-*•]\s+/, ""));
    if (info.features.length >= 10) break;
  }
  return info;
}

export function productMissing(info: ProductInfo): string[] {
  const miss: string[] = [];
  if (!info.title) miss.push("nombre");
  if (!info.price) miss.push("precio");
  if (!info.images.length && !info.videoUrls.length) miss.push("imágenes o vídeos");
  if (!info.description) miss.push("descripción");
  if (!info.seller) miss.push("vendedor");
  return miss;
}

/**
 * Descarga best-effort. NUNCA lanza por datos ausentes: devuelve lo que pueda.
 */
export async function fetchProduct(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ProductFetchResult> {
  const { fetchWithTimeout } = await import("@/lib/net");
  const parsed = parseAliUrl(url);
  const target = parsed?.normalized ?? url;

  // 1) directo (fallará por CORS en el navegador; útil en tests/SSR)
  try {
    const res = await fetchWithTimeout(target, {
      timeoutMs: opts.timeoutMs ?? 12000,
      signal: opts.signal,
      headers: { Accept: "text/html,*/*" },
    });
    if (res.ok) {
      const html = await res.text();
      const info = extractFromMarkdown(html, target);
      return { info, missing: productMissing(info), source: "direct" };
    }
  } catch {}

  // 2) lector público sin claves (r.jina.ai) — solo METADATOS del producto
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${target}`, {
      timeoutMs: opts.timeoutMs ?? 20000,
      signal: opts.signal,
    });
    if (res.ok) {
      const md = await res.text();
      const info = extractFromMarkdown(md, target);
      return { info, missing: productMissing(info), source: "reader" };
    }
  } catch {}

  // 3) nada — modo manual
  const info = emptyProduct(target);
  return { info, missing: productMissing(info), source: "none" };
}
