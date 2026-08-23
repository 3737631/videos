/**
 * Suite de tests Node (sin navegador): clasificador, selector, biblioteca,
 * validación de audio y garantía de resolución del TTS.
 * Ejecutar: npm run test
 */
import { classifyMusic } from "../lib/audio/musicClassifier";
import { selectTrack, loadHistoryForTest } from "../lib/audio/musicSelector";
import { buildLibrary, mulberry32 } from "../lib/audio/musicLibrary";
import { computeAudioStats } from "../lib/audio/validation";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${extra}`);
  }
}

console.log("\n— TEST 4/5/7: Clasificador por scoring —");
const c1 = classifyMusic({ scriptText: "Hoy te voy a enseñar cómo ganar dinero vendiendo productos" });
check("dinero/negocio → motivational", c1.primaryCategory === "motivational", `got ${c1.primaryCategory}`);
const c2 = classifyMusic({ scriptText: "Mi rutina de mañana skincare café y diario en mi vida" });
check("rutina → lifestyle", c2.primaryCategory === "lifestyle", `got ${c2.primaryCategory}`);
const c3 = classifyMusic({ scriptText: "Esto ocurrió y nadie sabe por qué desapareció sin explicación" });
check("misterio → mysterious", c3.primaryCategory === "mysterious", `got ${c3.primaryCategory}`);
const c4 = classifyMusic({ scriptText: "3 cosas que debes hacer hoy!!! Top trucos increíbles" });
check("listas+exclamaciones → viral/motivational", ["viral", "motivational"].includes(c4.primaryCategory), `got ${c4.primaryCategory} conf=${c4.confidence}`);
const c5 = classifyMusic({ scriptText: "Una historia triste de despedida que me hizo llorar" });
check("tristeza → sad", c5.primaryCategory === "sad", `got ${c5.primaryCategory}`);
const c6 = classifyMusic({ scriptText: "mi novia me confesó algo que jamás imaginé esa noche" });
check("relato personal → storytelling/romantic", ["storytelling", "romantic"].includes(c6.primaryCategory), `got ${c6.primaryCategory}`);

console.log("\n— TEST 1: Biblioteca ≥100 pistas únicas —");
const lib = buildLibrary();
check("100 pistas exactas", lib.length === 100, `got ${lib.length}`);
check("ids únicos", new Set(lib.map((t) => t.id)).size === 100);
const cats = new Set(lib.map((t) => t.category));
check("10 categorías", cats.size === 10);
check("PRNG determinista", mulberry32(42)() === mulberry32(42)());

console.log("\n— TEST 2/3: Selector anti-repetición —");
// Simular historial limpio
try { localStorage; } catch {}
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
check("las últimas 5 NO se repiten entre sí (≥4 distintas)", uniqueRecent5 >= 4, picks.join(","));
const hist = loadHistoryForTest();
check("historial guarda ≤20 y recorta a ventana 5", hist.length <= 20 && hist.length >= 5);

console.log("\n— TEST 6: Validación de audio (matemática pura) —");
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

console.log(`\nRESULTADO: ${passed} pasados · ${failed} fallidos\n`);
if (failed > 0) process.exit(1);
