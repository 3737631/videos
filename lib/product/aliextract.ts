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
  source: "direct" | "reader" | "none" | "slug";
  /** true cuando usamos el nombre del propio enlace porque la página
   *  pedía captcha/estaba bloqueada y no se pudo leer. */
  usedUrlName?: boolean;
}

/**
 * Extrae un nombre legible del propio enlace (OFFLINE, sin red).
 * AliExpress suele incluir el "slug" del producto en la URL:
 *   .../i/wireless-bluetooth-earbuds-5-3-noise-cancelling_100500...html
 * Sirve como fallback cuando la página pide captcha o está bloqueada,
 * de modo que el guion siempre tenga un nombre real del producto.
 */
export function extractAliNameFromUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
  let slug = seg
    .replace(/_\d{10,20}\.html?$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/^item-?/i, "");
  const words = slug
    .split(/[-_.]+/)
    .map((w) => w.replace(/[^a-z0-9áéíóúñü\s]/gi, "").trim())
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  if (words.length < 2) return null;
  const name = words.join(" ").replace(/\s+/g, " ").trim();
  return name.length >= 4 ? name : null;
}

/** Detecta si el contenido devuelto es una página de captcha/bloqueo. */
function looksLikeCaptcha(md: string): boolean {
  return /captcha|verify you are (a )?human|unusual traffic|robot check|are you a robot|please enable cookies|cloudflare|just a moment/i.test(
    md.slice(0, 4000)
  );
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
  /(?:\/item\/|\/i\/|itemId=|productId[=:]?|id[=:]?)(\d{10,20})/i;

/** Valida host AliExpress y extrae el ID numérico del ítem (10-20 dígitos). */
export function parseAliUrl(raw: string): { itemId: string; normalized: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/aliexpress\.(com|us|[a-z.]+)$/.test(host) && !/ali\.express/.test(host)) {
    return null;
  }
  const m =
    raw.match(ID_RE) ||
    `${u.pathname}${u.search}`.match(ID_RE) ||
    host.match(/(\d{10,20})/) ||
    u.pathname.match(/\/(\d{10,20})(?:\.html|\/|$)/);
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

  // Título: múltiples patrones AliExpress (incluye subject/productTitle de JSON-LD y s.click)
  const titleTag = md.match(/<title>([^<]{6,200})<\/title>/i);
  const ogTitle = md.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{6,200})["']/i);
  const h1 = md.match(/^#\s+(.{6,180})$/m);
  const tLine = md.match(/^Title:\s*(.+)$/m);
  const jsonLd = md.match(/"name"\s*:\s*"([^"]{6,200})"/);
  const subject = md.match(/"subject"\s*:\s*"([^"]{6,200})"/i);
  const prodTitle = md.match(/"productTitle"\s*:\s*"([^"]{6,200})"/i);
  const aliTitle = md.match(/"title"\s*:\s*"([^"]{6,200})"\s*,\s*"detailDesc"/i);
  let rawTitle = (ogTitle?.[1] || subject?.[1] || prodTitle?.[1] || aliTitle?.[1] || titleTag?.[1] || tLine?.[1] || h1?.[1] || jsonLd?.[1] || "").trim();
  // Limpia sufijo " - AliExpress" y entidades
  rawTitle = rawTitle.replace(/\s*-\s*AliExpress\s*$/i, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
  info.title = rawTitle || null;

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
  const slugName = extractAliNameFromUrl(url);

  // Intenta leer la página. Si pide captcha/bloquea, no pasa nada: caemos
  // al nombre del enlace (slug) para que el guion siempre tenga producto.
  const tryRead = async (src: "direct" | "reader"): Promise<ProductInfo | null> => {
    try {
      const endpoint =
        src === "direct"
          ? target
          : `https://r.jina.ai/${target}`;
      const res = await fetchWithTimeout(endpoint, {
        timeoutMs: opts.timeoutMs ?? 20000,
        signal: opts.signal,
        headers: src === "direct" ? { Accept: "text/html,*/*" } : {},
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (looksLikeCaptcha(text)) return null; // página de captcha: ignorar
      const info = extractFromMarkdown(text, target);
      if (!info.title) return null;
      return info;
    } catch {
      return null;
    }
  };

  // 1) directo (falla por CORS en el navegador; útil en tests/SSR)
  const direct = await tryRead("direct");
  if (direct) return { info: direct, missing: productMissing(direct), source: "direct" };

  // 2) lector público sin claves (r.jina.ai) — solo METADATOS del producto
  const reader = await tryRead("reader");
  if (reader) return { info: reader, missing: productMissing(reader), source: "reader" };

  // 3) captcha/bloqueo o sin red: usamos el nombre del propio enlace
  if (slugName) {
    const info = emptyProduct(target);
    info.title = slugName;
    return { info, missing: productMissing(info), source: "slug", usedUrlName: true };
  }

  // 4) nada — modo manual
  const info = emptyProduct(target);
  return { info, missing: productMissing(info), source: "none" };
}
