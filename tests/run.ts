/**
 * TESTS V3 — suite Node (tsx). Cubre toda la lógica pura del pipeline:
 * catálogo, subtítulos, nicho, selector musical, progreso, red y etapas.
 */
import assert from "node:assert";
import http from "node:http";
import { VOICE_CATALOG, getVoiceById, sameLanguageAlternates, DEFAULT_VOICE_BY_LANG } from "../lib/voices/catalog";
import { splitSentences, synthesize } from "../lib/voices/engine";
import { buildSubtitles, styleForNiche } from "../lib/subtitles";
import { detectNiche, suggestedSpeechRate, suggestedCTA, NICHE_PALETTES } from "../lib/niche";
import { detectScriptLang, runStage, type PipelineHandlers } from "../lib/pipeline";
import { pickTrackPure } from "../lib/audio/musicSelector";
import { buildLibrary } from "../lib/audio/musicLibrary";
import {
  STAGE_BANDS,
  STAGE_LABELS,
  createProgressTracker,
  type StageName,
} from "../lib/progress";
import { toFriendlyError, fetchBinaryWithProgress, TimeoutError } from "../lib/net";
import { hashKey } from "../lib/idb";
import {
  parseAliUrl,
  extractAliNameFromUrl,
  extractFromMarkdown,
  productMissing,
} from "../lib/product/aliextract";
import {
  wordsForDuration,
  generateScript,
  correctiveSpeed,
  countWords,
} from "../lib/script/generator";
import {
  VOICE_STYLES,
  getStyle,
  roleSpeedOf,
  segmentRoles,
  recommendStyle,
} from "../lib/script/styles";
import {
  orientationOf,
  nearestFps,
} from "../lib/media/probe";
import { selectSegments, pickTargetDuration } from "../lib/video/highlights";
import {
  computeProsodyTimings,
} from "../lib/voices/engine";
import { classifyMusic } from "../lib/audio/musicClassifier";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function t(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(name);
      console.error(`  ✗ ${name}\n    ${e?.message ?? e}`);
    });
}

function fakeHandlers(signal?: AbortSignal): PipelineHandlers {
  return { onStage: () => {}, signal };
}

async function main() {
  console.log("\n── Catálogo de voces ──");
  await t("IDs únicos", () => {
    const ids = new Set(VOICE_CATALOG.map((v) => v.id));
    assert.equal(ids.size, VOICE_CATALOG.length);
  });
  await t("Voces Piper con URL y tamaño reales", () => {
    for (const v of VOICE_CATALOG.filter((x) => x.runtime === "piper")) {
      // URL de HuggingFace o auto-alojada en el mismo origen ("local:")
      assert.ok(
        v.modelUrl!.startsWith("https://huggingface.co/rhasspy/piper-voices/") ||
          v.modelUrl!.startsWith("local:"),
        `${v.id} URL inesperada: ${v.modelUrl}`
      );
      assert.ok(v.configUrl!.endsWith(".onnx.json"));
      assert.ok(v.sizeBytes > 20_000_000, `${v.id} sin tamaño real`);
      assert.match(v.id, /^(es|fr|de|it|pt)_/);
    }
  });
  await t("Idiomas cubiertos ES/EN/FR/DE/IT/PT + fallback mismo idioma", () => {
    for (const lang of Object.keys(DEFAULT_VOICE_BY_LANG)) {
      const id = DEFAULT_VOICE_BY_LANG[lang];
      assert.ok(getVoiceById(id), `falta voz por defecto ${lang}`);
    }
    const alts = sameLanguageAlternates("es_ES-carlfm-x_low");
    assert.ok(alts.length >= 1 && alts.every((v) => v.locale === "es-ES"));
  });

  console.log("\n── División de frases (TTS) ──");
  await t("splitSentences: nunca supera el máximo y conserva palabras", () => {
    const long = Array.from({ length: 40 }, (_, i) => `palabra${i} mas`).join(" ") + ".";
    const parts = splitSentences(long, 120);
    for (const p of parts) assert.ok(p.length <= 130);
    const wordsIn = long.split(/\s+/).filter((w) => w !== ".").length;
    const wordsOut = parts.join(" ").split(/\s+/).filter(Boolean).length;
    assert.equal(wordsOut, wordsIn);
  });

  console.log("\n── Subtítulos estilo CapCut ──");
  await t("Con voz genera tarjetas de máx. 2 líneas y resaltado coherente", () => {
    const script =
      "Este gadget cuesta solo 19 euros con envio GRATIS. Mira lo que hace! Es increíble para tu cocina y llega hoy mismo a tu casa.";
    const { cues } = buildSubtitles(script, 12.5, { charsPerLine: 24 });
    assert.ok(cues.length >= 3);
    let emojis = 0;
    for (const c of cues) {
      assert.ok(c.text.split("\n").length <= 2, "más de 2 líneas");
      assert.equal(c.highlight!.length, c.words.length);
      emojis += (c.text.match(/\p{Extended_Pictographic}/gu) || []).length;
      assert.ok(c.end > c.start && c.start >= 0 && c.end <= 12.5 + 0.01);
    }
    assert.ok(emojis <= 3, "demasiados emojis");
    assert.ok(cues.some((c) => c.highlight!.some(Boolean)), "sin resaltados");
  });
  await t("Modo solo-música = CERO subtítulos", () => {
    const { cues } = buildSubtitles("hola mundo", null);
    assert.equal(cues.length, 0);
  });
  await t("Estilo usa paleta del nicho y animación pop", () => {
    const s = styleForNiche("tiktokshop");
    assert.equal(s.animation, "pop");
    assert.equal(s.activeColor, NICHE_PALETTES.tiktokshop.activeColor);
  });

  console.log("\n── Modo dropshipping ──");
  await t("Detecta TikTok Shop / producto viral", () => {
    const n = detectNiche("Compra ahora en TikTok Shop, envío gratis solo hoy");
    assert.ok(n.isDropshipping);
  });
  await t("Clasifica nicho por palabras clave", () => {
    assert.equal(detectNiche("mi rutina skincare con este serum").niche, "belleza");
    assert.equal(detectNiche("la freidora de aire perfecta en tu cocina").niche, "cocina");
    assert.equal(detectNiche("este cargador powerbank es un gran gadget").niche, "gadget");
    assert.ok(!detectNiche("hola que tal").isDropshipping);
  });
  await t("Ajustes derivados: velocidad y CTA solo en español", () => {
    const n = detectNiche("dropshipping gadget");
    assert.equal(suggestedSpeechRate(n), 1.08);
    assert.ok(suggestedCTA(n, "es").length > 0);
    assert.equal(suggestedCTA(n, "en"), "");
    assert.equal(suggestedSpeechRate(detectNiche("receta de la abuela")), 1);
  });

  console.log("\n── Idioma del guion ──");
  await t("Detección heurística ES/EN/FR", () => {
    assert.equal(detectScriptLang("Mira este truco para tu casa, es gratis y funciona ahora"), "es");
    assert.equal(detectScriptLang("Look at this best gadget for your kitchen, wait for it"), "en");
    assert.equal(detectScriptLang("Regarde ce gadget pour la maison avec cette offre"), "fr");
  });

  console.log("\n── Música: selección anti-repetición ──");
  await t("Biblioteca con 100 pistas únicas", () => {
    const lib = buildLibrary();
    assert.equal(lib.length, 100);
    assert.equal(new Set(lib.map((x) => x.id)).size, 100);
  });
  await t("Anti-repetición: separación mínima de 10 vídeos entre repeticiones", () => {
    const lib = buildLibrary();
    const cat = lib[0].category;
    const recent: string[] = [];
    for (let i = 0; i < 40; i++) {
      const { track } = pickTrackPure(cat, cat, 1000 + i * 7919, new Set(recent.slice(-10)), recent);
      // con categoría de exactamente 10 pistas, la misma puede volver tras el
      // ciclo completo, pero NUNCA antes de 10 selecciones
      assert.ok(!recent.slice(-9).includes(track.id), `${track.id} volvió antes de 10`);
      recent.push(track.id);
    }
    const gaps = new Map<string, number>();
    for (let i = 0; i < recent.length; i++) {
      const prev = gaps.get(recent[i]);
      if (prev !== undefined) assert.ok(i - prev >= 10);
      gaps.set(recent[i], i);
    }
  });

  console.log("\n── Progreso monótono ──");
  await t("Bandas válidas y etiquetas completas", () => {
    const stages = Object.keys(STAGE_BANDS) as Exclude<StageName, "ERROR">[];
    let prev = -1;
    for (const s of stages) {
      const [a, b] = STAGE_BANDS[s as keyof typeof STAGE_BANDS];
      assert.ok(b >= a && a >= prev, `banda desordenada en ${s}`);
      assert.ok(STAGE_LABELS[s as StageName]);
      prev = b;
    }
    assert.equal(STAGE_BANDS.DONE[1], 100);
  });
  await t("El % nunca retrocede ni se pasa", () => {
    const seen: number[] = [];
    const tr = createProgressTracker((_s, _l, pct) => seen.push(pct));
    tr.set("GENERATING_VOICE", 50);
    tr.set("PREPARING"); // retrocedería → se clampa
    tr.set("RENDERING", 30);
    tr.done();
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
    assert.equal(seen[seen.length - 1], 100);
    assert.equal(tr.current(), 100);
  });

  console.log("\n── Etapas: timeout / reintento / cancelación ──");
  await t("runStage reintenta y triunfa en el 2º intento", async () => {
    let calls = 0;
    const out = await runStage(
      "ANALYZING_SCRIPT",
      async () => {
        calls++;
        if (calls < 2) throw new Error("boom");
        return "ok";
      },
      fakeHandlers(),
      createProgressTracker(() => {}),
      { timeoutMs: 2000, retries: 2 }
    );
    assert.equal(out, "ok");
    assert.equal(calls, 2);
  });
  await t("Timeout duro dispara TimeoutError", async () => {
    await assert.rejects(
      runStage("MIXING_AUDIO", () => new Promise(() => {}), fakeHandlers(), createProgressTracker(() => {}), {
        timeoutMs: 80,
        retries: 0,
      }),
      TimeoutError
    );
  });
  await t("Abort externo cancela al instante", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 30);
    await assert.rejects(
      runStage("RENDERING", (sig) => new Promise((_, rej) => sig.addEventListener("abort", () => rej(new DOMException("x", "AbortError")))), fakeHandlers(ctrl.signal), createProgressTracker(() => {}), {
        timeoutMs: 5000,
        retries: 3,
      }),
      (e: unknown) => (e instanceof DOMException ? e.name === "AbortError" : false)
    );
  });

  console.log("\n── Cache de audio (clave estable) ──");
  await t("hashKey determinista y sensible", () => {
    assert.equal(hashKey("hola|mundo"), hashKey("hola|mundo"));
    assert.notEqual(hashKey("hola|mundo"), hashKey("hola|mondo"));
  });
  await t("synthesize rechaza guion vacío sin tocar red", async () => {
    await assert.rejects(synthesize("", "es_ES-carlfm-x_low"), /Guion vacío/);
    await assert.rejects(synthesize("hola", "voz-inexistente"), /Voz desconocida/);
  });

  console.log("\n── Errores humanizados ──");
  await t("toFriendlyError mapea fallos comunes", () => {
    assert.match(toFriendlyError(new Error("Failed to fetch")), /Sin conexión/);
    assert.match(toFriendlyError(new TimeoutError(30000)), /Tardó demasiado/);
    assert.equal(toFriendlyError(new DOMException("x", "AbortError")), "Operación cancelada.");
    assert.equal(toFriendlyError(undefined), "Algo salió mal.");
  });

  console.log("\n── Red: progreso binario con servidor local ──");
  await t("fetchBinaryWithProgress reporta bytes y ensambla", async () => {
    const payload = Buffer.alloc(64 * 1024, 7);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Length": String(payload.length) });
      res.end(payload);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    let events = 0;
    try {
      const buf = await fetchBinaryWithProgress(
        `http://127.0.0.1:${addr.port}/bin`,
        (l, tot) => {
          events++;
          if (tot) assert.ok(tot >= l);
        },
        { timeoutMs: 5000 }
      );
      assert.equal(buf.byteLength, payload.length);
      assert.ok(events > 0);
    } finally {
      server.close();
    }
  });

  console.log("\n── Enlace AliExpress ──");
  await t("parseAliUrl acepta formatos reales y normaliza", () => {
    const a = parseAliUrl("https://es.aliexpress.com/item/1005006123456789.html?spm=x");
    assert.ok(a && a.itemId === "1005006123456789");
    const b = parseAliUrl("http://a.aliexpress.com/_mKXYZ123"); // sin ID → null (no se inventa)
    assert.equal(b, null);
    const c = parseAliUrl("https://www.youtube.com/watch?v=x");
    assert.equal(c, null);
    const d = parseAliUrl("https://www.aliexpress.com/item/1005001111111111.html");
    assert.ok(d && d.itemId === "1005001111111111");
  });
  await t("extractFromMarkdown saca título/precio/imágenes/vendedor", () => {
    const md = [
      "# Mini sellador de bolsas portátil",
      "Price: US $3.98",
      "![img](https://ae-pic.alicdn.com/x/y.jpg_.webp)",
      "<video src='https://o.aliexpress.com/a/b.mp4'></video>",
      "Store: HomeGadgets Store",
      "- Cierre hermético en segundos",
      "- Funciona con pilas AAA",
    ].join("\n");
    const info = extractFromMarkdown(md, "https://es.aliexpress.com/item/1005009999.html");
    assert.match(info.title ?? "", /sellador/i);
    assert.equal(info.price, "3.98");
    assert.equal(info.images.length, 1);
    assert.equal(info.videoUrls.length, 1);
    assert.match(info.seller ?? "", /HomeGadgets/);
    assert.equal(info.features.length, 2);
  });
  await t("productMissing lista lo ausente sin bloquear", () => {
    const miss = productMissing(extractFromMarkdown("", "https://x.com/item/1.html"));
    assert.ok(miss.includes("nombre") && miss.includes("precio"));
  });

  console.log("\n── Guion ajustado a duración ──");
  await t("presupuesto de palabras para 10/15/30/60 s", () => {
    for (const sec of [10, 15, 30, 60]) {
      const w = wordsForDuration(sec, "es", 1);
      assert.ok(Math.abs(w - sec * 2.45) <= 1.5, `${sec}s → ${w}`);
    }
  });
  await t("generateScript encaja el presupuesto y no inventa specs", () => {
    const product = { title: "Mini selladora de bolsas", price: "3.98", currency: "USD" };
    for (const sec of [10, 15, 30]) {
      const g = generateScript({ durationSec: sec, lang: "es", product, seed: "u1" });
      assert.ok(Math.abs(g.words - g.targetWords) <= 12, `${sec}s: ${g.words}/${g.targetWords}`);
      // nunca inventa un precio distinto del dado
      if (!g.text.includes("3.98") && !g.text.includes("$")) {
        assert.fail("no usa el precio real ni frase genérica de oferta");
      }
      assert.ok(!/\b\d{4,}\b/.test(g.text), "sin cifras inventadas largas");
    }
  });
  await t("correctiveSpeed solo actúa fuera de tolerancia y acota", () => {
    assert.equal(correctiveSpeed(17.0, 17.0, 0.25), null);
    assert.equal(correctiveSpeed(17.2, 17.0, 0.25), null);
    const s = correctiveSpeed(20, 17, 0.25)!;
    assert.ok(s > 1 && s <= 1.35);
    const s2 = correctiveSpeed(10, 17, 0.25)!;
    assert.ok(s2 >= 0.78 && s2 < 1);
  });

  console.log("\n── Estilos de voz (params reales) ──");
  await t("estilos dentro de límites TTS y roles coherentes", () => {
    for (const st of VOICE_STYLES) {
      for (const role of ["hook", "problema", "cta"] as const) {
        const sp = roleSpeedOf(st, role);
        assert.ok(sp >= 0.7 && sp <= 1.5, `${st.id}/${role}=${sp}`);
      }
    }
    assert.ok(roleSpeedOf(getStyle("urgente"), "cta") > roleSpeedOf(getStyle("natural"), "cta"));
  });
  await t("segmentRoles: primera=hook, última=cta, medios por palabras clave", () => {
    const segs = segmentRoles(
      "Espera… esto lo cambia todo. Si llevas meses con este problema ya está bien. Con esto lo resuelves en segundos. Corre, toca el enlace antes de que se agote."
    );
    assert.equal(segs[0].role, "hook");
    assert.equal(segs[segs.length - 1].role, "cta");
    assert.ok(segs.some((s) => s.role === "problema"));
    assert.ok(segs.some((s) => s.role === "beneficio"));
  });
  await t("recommendStyle según contenido y duración", () => {
    assert.equal(recommendStyle({ scriptText: "Corre, se agota, solo hoy" }), "urgente");
    assert.equal(recommendStyle({ scriptText: "Un día cualquiera… resulta que todo cambió", isDropshipping: false }), "storytelling");
    assert.equal(recommendStyle({ scriptText: "Mira este producto viral", isDropshipping: true, durationSec: 10 }), "viral");
  });

  console.log("\n── Timestamps reales (prosodia) ──");
  await t("computeProsodyTimings acumula monótono e inserta pausas", () => {
    const tl = computeProsodyTimings(
      [{ text: "a", duration: 1 }, { text: "b", duration: 2 }],
      [300, 0]
    );
    assert.equal(tl[0].start, 0);
    assert.equal(tl[0].end, 1);
    assert.equal(tl[1].start, 1.3); // pausa 300 ms
    assert.equal(tl[1].end, 3.3);
    for (let i = 1; i < tl.length; i++) assert.ok(tl[i].start >= tl[i - 1].end - 1e-9);
  });

  console.log("\n── Análisis de vídeos subidos (helpers puros) ──");
  await t("orientación y FPS estimado", () => {
    assert.equal(orientationOf(1080, 1920), "vertical");
    assert.equal(orientationOf(1920, 1080), "horizontal");
    assert.equal(orientationOf(1000, 1000), "cuadrado");
    assert.equal(nearestFps(29.97), 30);
    assert.equal(nearestFps(59.8), 60);
    assert.equal(nearestFps(24.5), 24);
  });

  console.log("\n── Subtítulos anclados a segmentos reales ──");
  await t("los cues respetan las ventanas reales de cada frase", () => {
    const script = "Hola mundo esto es una prueba larga. Y aquí va la segunda parte final.";
    const timings = [
      { text: "Hola mundo esto es una prueba larga.", start: 0, end: 2.4 },
      { text: "Y aquí va la segunda parte final.", start: 2.65, end: 4.1 },
    ];
    const { cues } = buildSubtitles(script, 4.1, { segTimings: timings });
    assert.ok(cues.length >= 2);
    // ninguna tarjeta empieza fuera de su ventana
    for (const c of cues) {
      const win = c.start < 2.5 ? timings[0] : timings[1];
      assert.ok(c.start >= win.start - 1e-6 && c.end <= win.end + 0.05);
    }
    assert.notEqual(cues[cues.length - 1].end, cues[0].end);
  });

  console.log("\n── Música contextual extendida ──");
  await t("classifyMusic acepta tono/duración y devuelve categorías válidas", () => {
    const libCats = new Set(buildLibrary().map((t) => t.category));
    const a = classifyMusic({ scriptText: "compra ahora", projectStyle: "urgente", goal: "ventas", durationSec: 12 });
    assert.ok(libCats.has(a.primaryCategory));
    const b = classifyMusic({ scriptText: "", projectStyle: "emocional", durationSec: 55 });
    assert.ok(libCats.has(b.primaryCategory));
    assert.ok(a.energy >= 0 && a.energy <= 1);
  });

  console.log("\n── Momentos virales (highlights) ──");
  await t("pickTargetDuration acota segun fuente y modo", () => {
    assert.equal(pickTargetDuration(8, false), 8); // corto: usa todo
    assert.equal(pickTargetDuration(30, false), 11); // 30*0.38=11.4 -> 11 (optimizado rapido)
    assert.equal(pickTargetDuration(30, true), 17); // 30*0.55=16.5 -> 17
    assert.equal(pickTargetDuration(200, false), 20); // tope 20 (optimizado rapido)
    assert.equal(pickTargetDuration(0, false), 12); // sin dato -> 12
  });
  await t("selectSegments elige el tramo mas movido y encaja el objetivo", () => {
    const scores = [0, 0, 0, 0, 9, 9, 9, 9, 0, 0];
    const segs = selectSegments(scores, 1, 4);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].start, 4);
    assert.equal(segs[0].end, 8);
    const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
    assert.ok(total >= 3 && total <= 5);
  });
  await t("selectSegments devuelve todo si el video cabe en el objetivo", () => {
    const segs = selectSegments([1, 1, 1, 1], 1, 20);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].start, 0);
    assert.equal(segs[0].end, 4);
  });
  await t("selectSegments no solapa y ordena cronologicamente", () => {
    // dos picos bien separados
    const scores = Array.from({ length: 20 }, (_, i) =>
      i >= 2 && i <= 5 ? 9 : i >= 14 && i <= 17 ? 8 : 0
    );
    const segs = selectSegments(scores, 1, 8);
    assert.ok(segs.length >= 2);
    for (let i = 1; i < segs.length; i++) assert.ok(segs[i].start >= segs[i - 1].end - 1e-6);
    const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
    assert.ok(total >= 8 && total <= 9, `total=${total}`);
  });

  console.log("\n── AliExpress: deteccion ampliada ──");
  await t("parseAliUrl acepta /i/ y ?itemId= y rechaza hosts ajenos", () => {
    const a = parseAliUrl("https://es.aliexpress.com/i/1005002222222222.html");
    assert.ok(a && a.itemId === "1005002222222222");
    const b = parseAliUrl("https://www.aliexpress.us/item/1005003333333333.html?spm=x");
    assert.ok(b && b.itemId === "1005003333333333");
    const c = parseAliUrl("https://es.aliexpress.com/item/1005004444444444.html?itemId=1005004444444444");
    assert.ok(c && c.itemId === "1005004444444444");
    assert.equal(parseAliUrl("https://www.amazon.com/dp/B012345678"), null);
  });

  await t("extractAliNameFromUrl saca el nombre del slug aunque pida captcha", () => {
    const a = extractAliNameFromUrl(
      "https://es.aliexpress.com/i/wireless-bluetooth-earbuds-5-3-noise-cancelling_1005006123456789.html"
    );
    assert.equal(a, "wireless bluetooth earbuds noise cancelling");
    const b = extractAliNameFromUrl("https://www.aliexpress.com/item/1005001111111111.html");
    assert.equal(b, null); // sin slug legible -> null (modo manual)
  });

  console.log(`\n════════ RESULTADO: ${passed} pasan · ${failed} fallan ════════`);
  if (failed > 0) {
    console.error("Fallan:", failures.join(", "));
    process.exitCode = 1;
  }
}

main().finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50));
