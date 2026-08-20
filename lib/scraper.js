import puppeteer from "puppeteer-core";
import fs from "fs";

const MTOP_PATTERN = /mtop\.aliexpress\.pdp\.pc/;
const CDN_RE = /(alicdn\.com|aliimg\.com)/;

function resolveExecutablePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === "linux") return "/usr/bin/chromium";
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function walk(value, fn) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, fn);
    return;
  }
  if (typeof value === "object") {
    fn(value);
    for (const v of Object.values(value)) walk(v, fn);
  }
}

function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractTitle(payloads, dom) {
  let found = "";
  walk(payloads, (obj) => {
    if (found) return;
    found = firstString(obj, ["title", "subject", "titleWords"]);
    if (found.length < 10) found = "";
  });
  if (found) return found;
  const ld = dom.jsonld || [];
  for (const entry of ld) {
    const t = entry?.name || entry?.headline;
    if (typeof t === "string" && t.length > 10) return t.trim();
  }
  return dom.ogTitle || dom.dida?.itemData?.title || "";
}

function extractPrice(payloads, dom) {
  let found = "";
  walk(payloads, (obj) => {
    if (found) return;
    found = firstString(obj, [
      "price",
      "formatedPrice",
      "formatPrice",
      "finalPrice",
      "discountPrice",
      "salePrice",
      "priceRange",
      "priceText",
    ]);
    if (found && !/[\d.,]/.test(found)) found = "";
  });
  if (!found) {
    const ld = dom.jsonld || [];
    for (const entry of ld) {
      const offers = entry?.offers || entry?.offers?.offers;
      if (Array.isArray(offers)) {
        const p = offers.find((o) => o?.price || o?.lowPrice) || offers[0];
        if (p?.lowPrice) found = String(p.lowPrice);
        else if (p?.price) found = String(p.price);
      } else if (offers?.lowPrice) {
        found = String(offers.lowPrice);
      } else if (offers?.price) {
        found = String(offers.price);
      }
      if (found) break;
    }
  }
  if (!found) {
    const m = (dom.bodyText || "").match(/(?:US\s*\$|\$\s?)\s?[\d.,]+/);
    if (m) found = m[0];
  }
  const currency = /US\s*\$|US\$/.test(found) ? "USD" : "";
  return { price: found, currency };
}

function extractImages(payloads, dom) {
  const set = new Set();
  walk(payloads, (obj) => {
    for (const k of ["images", "imgs", "image", "mainImage", "imgUrl", "fullImage"]) {
      const v = obj?.[k];
      if (typeof v === "string" && CDN_RE.test(v)) set.add(v);
      else if (Array.isArray(v)) {
        for (const s of v) {
          if (typeof s === "string" && CDN_RE.test(s)) set.add(s);
          else if (typeof s === "object" && s && CDN_RE.test(s.imgUrl || "")) set.add(s.imgUrl);
        }
      }
    }
  });
  if (dom.ogImage && CDN_RE.test(dom.ogImage)) set.add(dom.ogImage);
  const ld = dom.jsonld || [];
  for (const entry of ld) {
    const img = entry?.image;
    if (typeof img === "string" && CDN_RE.test(img)) set.add(img);
    else if (Array.isArray(img)) for (const s of img) if (typeof s === "string" && CDN_RE.test(s)) set.add(s);
  }
  const didaImgs = dom.dida?.itemData?.imgs;
  if (Array.isArray(didaImgs)) {
    for (const s of didaImgs) {
      if (typeof s === "string") set.add(s);
      else if (s && typeof s.imgUrl === "string") set.add(s.imgUrl);
    }
  }
  return [...set].slice(0, 10);
}

function extractSeller(payloads, dom) {
  let seller = "";
  walk(payloads, (obj) => {
    if (seller) return;
    seller = firstString(obj, ["sellerName", "storeName", "companyName", "aliMemberName"]);
  });
  return seller;
}

function extractAttributes(payloads, dom) {
  const attrs = [];
  const seen = new Set();
  const push = (name, value) => {
    if (typeof name !== "string" || !name.trim()) return;
    let val = "";
    if (Array.isArray(value)) val = value.map((x) => (typeof x === "string" ? x : "")).filter(Boolean).join(", ");
    else if (typeof value === "string") val = value;
    else if (typeof value === "number") val = String(value);
    if (!val.trim()) return;
    const dedupKey = `${name.trim().toLowerCase()}::${val.trim().toLowerCase()}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    attrs.push({ name: name.trim(), value: val.trim() });
  };
  walk(payloads, (obj) => {
    const name = firstString(obj, ["name", "key", "attrName", "propertyName", "label"]);
    if (!name) return;
    const value = obj?.value ?? obj?.attrValue ?? obj?.propertyValue ?? obj?.text ?? obj?.content;
    if (value === undefined || value === null) return;
    push(name, value);
  });
  const didaProps = dom.dida?.itemData?.productProp;
  if (Array.isArray(didaProps)) {
    for (const p of didaProps) push(p?.name || p?.key, p?.value ?? p?.text);
  }
  if (!attrs.length) {
    const lines = (dom.bodyText || "").split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 120)) {
      const m = line.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 /&.,'()-]{2,60}):\s*(.+)$/);
      if (m && m[2].length <= 80 && !/^[-+.\d\s%€$]*$/.test(m[2])) push(m[1], m[2]);
    }
  }
  return attrs.slice(0, 80);
}

const CONFORMITY_RE =
  /fabricante|manufacturer|marca|brand|direcci|address|conform|rohs|\bce\b|certific|modelo|\bmodel\b|\bean\b|ensamblad|importad|origen|origin|pais|country|telefono|phone|warranty|garant/i;

function filterConformity(attrs) {
  return attrs.filter((a) => CONFORMITY_RE.test(`${a.name} ${a.value}`));
}

function parseMtopResponse(text) {
  if (!text) return null;
  let body = text.trim();
  // La API interna devuelve JSONP: mtopjsonp1({...})
  const cb = body.match(/^[a-zA-Z0-9_]+\((.*)\);?\s*$/s);
  if (cb) body = cb[1];
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function isSuccessPayload(json) {
  if (!json || !Array.isArray(json.ret)) return false;
  const ok = json.ret.some((r) => typeof r === "string" && r.startsWith("SUCCESS"));
  if (!ok) return false;
  const result = json.data?.result;
  if (!result) return false;
  const keys = Object.keys(result).filter((k) => !["errorCode", "i18n"].includes(k));
  return keys.length > 0;
}

function buildResult(url, payloads, dom) {
  const title = extractTitle(payloads, dom);
  const priceInfo = extractPrice(payloads, dom);
  const images = extractImages(payloads, dom);
  const seller = extractSeller(payloads, dom);
  const attributes = extractAttributes(payloads, dom);
  const conformity = filterConformity(attributes);

  if (!title && !images.length && !attributes.length) {
    throw new Error(
      "No se pudo extraer el producto (posible bloqueo anti-bot, CAPTCHA o enlace no valido de AliExpress)"
    );
  }

  return {
    url,
    title,
    price: priceInfo.price,
    currency: priceInfo.currency,
    image: images[0] || "",
    images,
    seller,
    attributes,
    conformity,
    source: payloads.length ? "mtop" : "dom",
  };
}

export async function extractProduct(url) {
  if (process.env.EXTRACT_FIXTURE) {
    try {
      const raw = fs.readFileSync(process.env.EXTRACT_FIXTURE, "utf8");
      const fixture = JSON.parse(raw);
      return { url, ...fixture, source: fixture.source || "fixture" };
    } catch (error) {
      throw new Error(`Fixture de extraccion no valido: ${error.message}`);
    }
  }

  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    throw new Error(
      "No se encontro Chrome/Edge. Define CHROME_PATH o instala Chromium (en el contenedor se usa /usr/bin/chromium)."
    );
  }

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--lang=es-ES",
  ];
  if (process.env.SCRAPERAPI_KEY) {
    args.push(
      `--proxy-server=http://scraperapi:${process.env.SCRAPERAPI_KEY}@proxy-server.scraperapi.com:8001`
    );
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-ES,es;q=0.9" });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "languages", { get: () => ["es-ES", "es"] });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      window.chrome = window.chrome || { runtime: {} };
    });

    const mtopUrls = new Set();
    const mtopPayloads = [];
    page.on("request", (req) => {
      if (MTOP_PATTERN.test(req.url())) mtopUrls.add(req.url());
    });
    page.on("response", async (res) => {
      try {
        if (MTOP_PATTERN.test(res.url())) {
          const json = parseMtopResponse(await res.text());
          if (json && isSuccessPayload(json)) mtopPayloads.push(json);
        }
      } catch {
        // respuesta no legible; se ignora
      }
    });

    await withTimeout(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }),
      32000,
      "Tiempo de carga de la pagina agotado"
    );
    await new Promise((r) => setTimeout(r, 4000));

    if (!mtopPayloads.length) {
      // Re-dispara las peticiones mtop que la pagina lanzo para reutilizar su
      // token/firma, hasta conseguir un payload con datos de producto.
      for (let attempt = 0; attempt < 3 && !mtopPayloads.length; attempt++) {
        for (const u of [...mtopUrls]) {
          try {
            const text = await withTimeout(
              page.evaluate(async (target) => {
                const res = await fetch(target);
                return await res.text();
              }, u),
              8000,
              "fetch lento"
            );
            const json = parseMtopResponse(text);
            if (json && isSuccessPayload(json)) mtopPayloads.push(json);
          } catch {
            // reintento
          }
        }
        if (!mtopPayloads.length) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    const dom = await page.evaluate(() => {
      const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || null;
      let dida = null;
      try {
        dida = window._dida_config_ || null;
      } catch {
        dida = null;
      }
      const jsonld = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          jsonld.push(JSON.parse(s.textContent));
        } catch {
          // JSON-LD malformado; se ignora
        }
      }
      return {
        ogTitle: meta('meta[property="og:title"]'),
        ogImage: meta('meta[property="og:image"]'),
        dida,
        jsonld,
        bodyText: (document.body?.innerText || "").slice(0, 4000),
      };
    });

    return buildResult(url, mtopPayloads, dom);
  } finally {
    await browser.close();
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}