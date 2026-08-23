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
      assert.ok(v.modelUrl!.startsWith("https://huggingface.co/rhasspy/piper-voices/"));
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

  console.log(`\n════════ RESULTADO: ${passed} pasan · ${failed} fallan ════════`);
  if (failed > 0) {
    console.error("Fallan:", failures.join(", "));
    process.exitCode = 1;
  }
}

main().finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50));
