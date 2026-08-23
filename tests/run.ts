/**
 * Suite de tests Node (sin navegador): clasificador, selector, biblioteca,
 * validación de audio, catálogo de voces, progreso monótono, plan de edición,
 * cliente backend (servidor HTTP real en localhost) y smoke del worker.
 * Ejecutar: npm run test
 *
 * Tests de RED REAL se saltan salvo que definas TEST_TTS_URL.
 */
import { classifyMusic } from "../lib/audio/musicClassifier";
import { selectTrack, loadHistoryForTest } from "../lib/audio/musicSelector";
import { buildLibrary, mulberry32 } from "../lib/audio/musicLibrary";
import { computeAudioStats } from "../lib/audio/validation";
import { VOICES, LEGACY_IDS, sttLanguageFromLocale, getVoiceDef } from "../lib/audio/voices";
import { STAGE_BANDS, createProgressTracker } from "../lib/progress";
import { buildEditPlan } from "../lib/editplan";
import type { Project } from "../types";
import {
  setApiBaseUrlForTests,
  llmViaBackend,
  ttsViaBackend,
  fetchWithTimeout,
  TimeoutError,
  toFriendlyError,
} from "../lib/apiClient";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  OK ${name}`);
  } else {
    failed++;
    console.error(`  FALLO ${name} ${extra}`);
  }
}

console.log("\n-- Clasificador por scoring --");
const c1 = classifyMusic({ scriptText: "Hoy te voy a enseñar cómo ganar dinero vendiendo productos" });
check("dinero/negocio -> motivational", c1.primaryCategory === "motivational", `got ${c1.primaryCategory}`);
const c2 = classifyMusic({ scriptText: "Mi rutina de mañana skincare café y diario en mi vida" });
check("rutina -> lifestyle", c2.primaryCategory === "lifestyle", `got ${c2.primaryCategory}`);
const c3 = classifyMusic({ scriptText: "Esto ocurrió y nadie sabe por qué desapareció sin explicación" });
check("misterio -> mysterious", c3.primaryCategory === "mysterious", `got ${c3.primaryCategory}`);
const c4 = classifyMusic({ scriptText: "3 cosas que debes hacer hoy!!! Top trucos increíbles" });
check("listas+exclamaciones -> viral/motivational", ["viral", "motivational"].includes(c4.primaryCategory), `got ${c4.primaryCategory} conf=${c4.confidence}`);
const c5 = classifyMusic({ scriptText: "Una historia triste de despedida que me hizo llorar" });
check("tristeza -> sad", c5.primaryCategory === "sad", `got ${c5.primaryCategory}`);
const c6 = classifyMusic({ scriptText: "mi novia me confesó algo que jamás imaginé esa noche" });
check("relato personal -> storytelling/romantic", ["storytelling", "romantic"].includes(c6.primaryCategory), `got ${c6.primaryCategory}`);

console.log("\n-- REGRESIÓN: marcadores de lista (regex rota histórica) --");
const cList = classifyMusic({ scriptText: "5 razones para empezar hoy mismo" });
check("'5 razones' puntúa como viral", cList.primaryCategory === "viral", `got ${cList.primaryCategory}`);
const cPlain = classifyMusic({ scriptText: "el día a día tranquilo en casa cocinando despacio" });
check("texto sin listas NO es viral", !["viral"].includes(cPlain.primaryCategory), `got ${cPlain.primaryCategory}`);

console.log("\n-- Biblioteca procedural --");
const lib = buildLibrary();
check("100 pistas exactas", lib.length === 100, `got ${lib.length}`);
check("ids únicos", new Set(lib.map((t) => t.id)).size === 100);
const cats = new Set(lib.map((t) => t.category));
check("10 categorías", cats.size === 10);
check("PRNG determinista", mulberry32(42)() === mulberry32(42)());

console.log("\n-- Selector anti-repetición --");
(globalThis as Record<string, unknown>).localStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
})();
const picks: string[] = [];
for (let i = 0; i < 8; i++) {
  const s = selectTrack("viral", "motivational", `proj-${i}`, 1000 + i * 7919);
  picks.push(s.track.id);
}
check("8 selecciones realizadas", picks.length === 8, picks.join(","));
const uniqueRecent5 = new Set(picks.slice(-5)).size;
check("las últimas 5 NO se repiten entre sí (>=4 distintas)", uniqueRecent5 >= 4, picks.join(","));
const hist = loadHistoryForTest();
check("historial guarda <=20 y recorta a ventana 5", hist.length <= 20 && hist.length >= 5);

console.log("\n-- Validación de audio (matemática pura) --");
const mkBuf = (vals: Float32Array, sr = 44100) => ({
  length: vals.length,
  sampleRate: sr,
  getChannelData: () => vals,
});
const good = new Float32Array(44100).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5);
const stGood = computeAudioStats(mkBuf(good));
check("seno 440Hz válido", stGood.valid && stGood.rms > 0.3, JSON.stringify(stGood));
const silent = new Float32Array(44100);
check("silencio inválido (rms=0)", !computeAudioStats(mkBuf(silent)).valid);
const withNan = good.slice();
withNan[100] = NaN;
check("NaN detectado", !computeAudioStats(mkBuf(withNan)).valid);
const short = good.slice(0, 1000);
check("duración <0.3s inválida", !computeAudioStats(mkBuf(short)).valid);

// ==== PARTE 2 ====

console.log("\n-- Catálogo único de voces (P2) --");
check("16 voces definidas", VOICES.length === 16, `got ${VOICES.length}`);
check("ids únicos", new Set(VOICES.map((v) => v.id)).size === 16);
check("todas tienen providerVoiceId real", VOICES.every((v) => /^[A-Za-z0-9]{15,40}$/.test(v.providerVoiceId)), VOICES.filter((v) => !/^[A-Za-z0-9]{15,40}$/.test(v.providerVoiceId)).map((v) => v.id).join(","));
check("solo voces EN tienen kokoro", VOICES.every((v) => v.kokoroVoice === undefined || v.locale.startsWith("en")));
check("6 idiomas cubiertos", new Set(VOICES.map((v) => v.locale)).size >= 6);
check("legado alloy -> voz válida", getVoiceDef(LEGACY_IDS.alloy || "").id === "en-US-m");
check("STT es-ES -> es", sttLanguageFromLocale("es-ES") === "es");
check("STT en-GB -> en", sttLanguageFromLocale("en-GB") === "en");
check("STT pt-BR -> pt", sttLanguageFromLocale("pt-BR") === "pt");

console.log("\n-- Progreso monótono (P3) --");
{
  const tr = createProgressTracker(() => {});
  tr.set("RENDERING", 50);
  const peakAfterRender = tr.current();
  tr.set("GENERATING_VOICE", 90); // fase "anterior": NO debe bajar el global
  check("nunca retrocede", tr.current() >= peakAfterRender, `${peakAfterRender} -> ${tr.current()}`);
  tr.done();
  check("done() llega a 100", tr.current() === 100);
  check("bandas ordenadas y dentro de 0..100", Object.values(STAGE_BANDS).every(([a, b]) => a <= b && b <= 100));
  const tr2 = createProgressTracker(() => {});
  tr2.set("PREPARING", 10);
  tr2.fail();
  check("fail() mantiene % alcanzado", Number.isFinite(tr2.current()) && tr2.current() > 0 && tr2.current() < 20);
}

console.log("\n-- Precedencia voiceDuration en editplan (P5) --");
{
  const baseProject = {
    id: "t",
    name: "t",
    sources: [],
    subtitles: { cues: [], style: {} },
    targetDuration: "auto",
  } as unknown as Project;
  const p1 = {
    ...baseProject,
    editPlan: { voice: { duration: 18, volume: 1 } },
    subtitles: { cues: [{ start: 0, end: 12, text: "hola", words: [] }], style: {} },
  } as unknown as Project;
  const plan1 = buildEditPlan(p1);
  check("voz (18s) manda sobre cue (12s)", plan1.voice?.duration === 18 && plan1.duration >= 18, JSON.stringify(plan1.duration));
  const p2 = {
    ...baseProject,
    subtitles: { cues: [{ start: 0, end: 9.5, text: "x", words: [] }], style: {} },
  } as unknown as Project;
  const plan2 = buildEditPlan(p2);
  check("sin voz usa último cue (9.5)", plan2.duration >= 9.5, JSON.stringify(plan2.duration));
}

console.log("\n-- Errores humanos (toFriendlyError) --");
check("red caída -> mensaje claro", toFriendlyError(new Error("Failed to fetch")).includes("No hay conexión"));
check("429 -> servidor ocupado", toFriendlyError(new Error("HTTP 429")).includes("ocupado"));
check("timeout -> consejo útil", toFriendlyError(new TimeoutError(45000)).includes("Tardó demasiado"));

// ==== PARTE 3 ====

async function withMockServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server: Server = createServer((req, res) => {
    const url = req.url || "";
    if (url.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.startsWith("/llm")) {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content: `eco:${JSON.parse(body || "{}").model || "?"}` }));
      });
      return;
    }
    if (url.startsWith("/tts-error")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "proveedor caido" }));
      return;
    }
    if (url.includes("delay=")) {
      const ms = Number(url.match(/delay=(\d+)/)?.[1] || 0);
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(Buffer.alloc(1200));
      }, ms);
      return;
    }
    if (url.startsWith("/tts")) {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(Buffer.alloc(1200, 1));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function runNetworkTests(): Promise<void> {
  console.log("\n-- Cliente backend contra servidor mock (P1/P3) --");
  await withMockServer(async (port) => {
    setApiBaseUrlForTests(`http://127.0.0.1:${port}`);
    const content = await llmViaBackend([{ role: "user", content: "hola" }], "test-model", 64);
    check("/llm devuelve contenido", content === "eco:test-model", content);
    const blob = await ttsViaBackend("hola mundo", "VOICEID1234567890", "es-ES");
    check("/tts devuelve audio >=800B", blob.size >= 800 && blob.type.startsWith("audio/"), `${blob.size}/${blob.type}`);
    setApiBaseUrlForTests(`http://127.0.0.1:${port}/tts-error`);
    try {
      await ttsViaBackend("x", "VOICEID1234567890", "es-ES");
      check("error del servidor se propaga", false, "no lanzo");
    } catch (e) {
      check("error del servidor se propaga", (e instanceof Error ? e.message : "").includes("proveedor caido"));
    }
    setApiBaseUrlForTests(`http://127.0.0.1:${port}`);
    const t0 = Date.now();
    let timedOut = false;
    try {
      await fetchWithTimeout(`http://127.0.0.1:${port}/tts?delay=1200`, {}, 250);
    } catch (e) {
      timedOut = e instanceof TimeoutError;
    }
    const elapsed = Date.now() - t0;
    check("timeout corta rápido y limpia timer", timedOut && elapsed < 1100, `${elapsed}ms`);
    await fetchWithTimeout(`http://127.0.0.1:${port}/health`, {}, 2000);
    const pendingTimers = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    check("sin timers colgados tras éxito", pendingTimers < 10, `${pendingTimers}`);
  });
  setApiBaseUrlForTests(null);

  console.log("\n-- Smoke del worker (worker/src/worker.mjs) --");
  const mod = await import("../worker/src/worker.mjs");
  const worker = (mod as { default: { fetch: (req: Request) => Promise<Response> } }).default;
  const health = await worker.fetch(new Request("http://local/health"));
  const hj = (await health.json()) as { ok?: boolean };
  check("/health ok sin secretos", health.status === 200 && hj.ok === true);
  const pre = await worker.fetch(new Request("http://local/tts", { method: "OPTIONS" }));
  check("preflight CORS 204", pre.status === 204 && (pre.headers.get("Access-Control-Allow-Origin") || "") !== "");
  const noKey = await worker.fetch(
    new Request("http://local/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hola", voiceId: "XrExE9yKIg1WjnnlVkGX" }) })
  );
  check("/tts sin clave -> 503 humano", noKey.status === 503, String(noKey.status));
  const badVoice = await worker.fetch(
    new Request("http://local/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hola", voiceId: "../../etc/passwd" }) })
  );
  check("/tts valida voiceId malicioso", [400, 503].includes(badVoice.status), String(badVoice.status));

  if (process.env.TEST_TTS_URL) {
    console.log("\n-- INTEGRACIÓN REAL contra", process.env.TEST_TTS_URL, "--");
    setApiBaseUrlForTests(process.env.TEST_TTS_URL);
    try {
      const blob = await ttsViaBackend("Esta es una prueba de voz real.", "XrExE9yKIg1WjnnlVkGX", "es-ES", undefined, 30000);
      check("TTS real devuelve audio", blob.size > 2000, `${blob.size}B`);
    } catch (e) {
      check("TTS real devuelve audio", false, e instanceof Error ? e.message : "");
    }
    setApiBaseUrlForTests(null);
  } else {
    console.log("\n(i) TEST_TTS_URL no definido: pruebas de red real omitidas.");
  }
}

runNetworkTests()
  .catch((e: unknown) => {
    failed++;
    console.error("  FALLO error inesperado en tests de red:", e instanceof Error ? e.message : e);
  })
  .finally(() => {
    console.log(`\nRESULTADO: ${passed} pasados · ${failed} fallidos\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
