"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProjectActions, useSettings } from "@/lib/useStore";
import type {
  Project,
  SourceVideo,
  VideoMetadata,
  HookOption,
  ScriptSegment,
} from "@/types";
import { buildEditPlan, getScriptFullText } from "@/lib/editplan";
import { generateHooks, generateScript, generateProductScript, transcribeWithTimestamps } from "@/lib/ai";
import { generateSpeech } from "@/lib/tts";
import { serviceStatus } from "@/lib/storage";
import { analyzeVideo } from "@/lib/analyze";
import { detectViralHighlights, type ViralSegment } from "@/lib/viral";
import { detectWatermark } from "@/lib/watermark";
import { isKokoroReady, onKokoroDownload, preloadKokoro } from "@/lib/tts";
import { classifyMusic } from "@/lib/audio/musicClassifier";
import { selectTrack } from "@/lib/audio/musicSelector";
import { renderTrack, type RenderedTrack } from "@/lib/audio/musicLibrary";
import { mixVoiceAndMusic } from "@/lib/audio/audioMixer";
import { assertVoiceAudio, assertMusicAudio, assertFinalAudio } from "@/lib/audio/validation";

// Detección de iPhone/iPad para optimizar velocidad de render
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
// Cualquier móvil: el modelo neuronal local NO se precarga (se usan proveedores rápidos)
const IS_MOBILE =
  IS_IOS ||
  (typeof navigator !== "undefined" && /Android|Mobile/i.test(navigator.userAgent));

/** Lee el texto de una página de producto (p.ej. AliExpress) sin bloqueos CORS */
async function fetchProductInfo(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`No se pudo leer el enlace (${res.status})`);
    const txt = await res.text();
    return txt.replace(/\s+/g, " ").trim().slice(0, 1500);
  } finally {
    clearTimeout(t);
  }
}
import { loadFfmpeg, isFfmpegLoaded, getFfmpeg, resetFfmpeg } from "@/lib/ffmpeg";
import { renderProject } from "@/lib/render";
import { renderProjectMobile } from "@/lib/renderMobile";
import { buildLibrary } from "@/lib/audio/musicLibrary";

function newProject(): Project {
  const id = crypto.randomUUID();
  return {
    id,
    name: "Nuevo vídeo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "draft",
    sources: [],
    metadata: null,
    style: "viral",
    goal: "engagement",
    targetDuration: "auto",
    hooks: [],
    selectedHook: "",
    script: [],
    voice: null,
    subtitles: { cues: [], style: { font: "system-ui", size: 72, weight: 800, color: "#fff", activeColor: "#fde047", shadow: true, stroke: false, strokeColor: "#000", position: "bottom", maxWidth: 86, animation: "pop" } },
    music: null,
    editPlan: null,
    renders: [],
    thumbnail: "",
  };
}

const FALLBACK_HOOKS: HookOption[] = [
  { id: "h1", text: "Wait for it… 🤯", score: 0.9 },
  { id: "h2", text: "You won't believe what happens next", score: 0.85 },
  { id: "h3", text: "POV: this changed everything", score: 0.8 },
];

function fallbackScript(hookText: string): ScriptSegment[] {
  return [
    { kind: "hook", text: hookText },
    { kind: "desarrollo", text: "Here is the moment everyone is talking about — watch closely." },
    { kind: "beneficio", text: "This trick makes your content pop instantly." },
    { kind: "cta", text: "Follow for more viral clips like this." },
  ];
}

export default function CrearPage() {
  const { saveProject } = useProjectActions();
  const [settings, setSettings] = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project>(newProject);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"analyzing" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [jobStage, setJobStage] = useState<{ stage: string; progress: number } | null>(null);
  const [voiceMode, setVoiceMode] = useState<"voz" | "musica">("voz");
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const [watermarkDetected, setWatermarkDetected] = useState(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const keepAudioRef = useRef<HTMLAudioElement | null>(null);

  // Mantiene la pestaña activa durante la creación: wake lock + audio silencioso
  async function startKeepAlive() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      /* sin wake lock */
    }
    try {
      if (!keepAudioRef.current) {
        const sr = 8000;
        const buf = new ArrayBuffer(44 + sr * 2);
        const dv = new DataView(buf);
        const ws = (o: number, s: string) => {
          for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
        };
        ws(0, "RIFF");
        dv.setUint32(4, 36 + sr * 2, true);
        ws(8, "WAVE");
        ws(12, "fmt ");
        dv.setUint32(16, 16, true);
        dv.setUint16(20, 1, true);
        dv.setUint16(22, 1, true);
        dv.setUint32(24, sr, true);
        dv.setUint32(28, sr * 2, true);
        dv.setUint16(32, 2, true);
        dv.setUint16(34, 16, true);
        ws(36, "data");
        dv.setUint32(40, sr * 2, true);
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
        const a = new Audio(url);
        a.loop = true;
        a.volume = 0.02;
        keepAudioRef.current = a;
      }
      await keepAudioRef.current.play().catch(() => {});
    } catch {
      /* sin audio keep-alive */
    }
  }

  function stopKeepAlive() {
    try {
      keepAudioRef.current?.pause();
    } catch {}
    try {
      wakeLockRef.current?.release();
    } catch {}
    wakeLockRef.current = null;
  }

  const [productUrl, setProductUrl] = useState("");
  const voicePctRef = useRef<number | null>(null);

  useEffect(() => {
    // La voz neuronal solo se precarga en escritorio; en móvil el TTS rápido
    // (StreamElements) no necesita descargas.
    const off = onKokoroDownload((pct) => {
      voicePctRef.current = pct;
    });
    if (!IS_MOBILE) void preloadKokoro();
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // TEST AUTOMÁTICO (consola): window.__ccSelfTest()
    // Valida clasificador → selector → síntesis → mezcla → validación + TTS real.
    type SelfTestWin = Window & { __ccSelfTest?: () => Promise<boolean> };
    (window as SelfTestWin).__ccSelfTest = async () => {
      const tag = "[SELFTEST]";
      /* eslint-disable no-console */
      console.log(`${tag} 1) Clasificador musical…`);
      try {
        const c1 = classifyMusic({ scriptText: "3 cosas que debes hacer para ganar dinero" });
        const c2 = classifyMusic({ scriptText: "mi rutina de mañana skincare y café" });
        const c3 = classifyMusic({ scriptText: "esto ocurrió y nadie sabe por qué" });
        console.log(`${tag}    dinero→${c1.primaryCategory} rutina→${c2.primaryCategory} misterio→${c3.primaryCategory}`);
        const lib = buildLibrary();
        if (lib.length < 100) throw new Error(`biblioteca incompleta: ${lib.length}`);
        console.log(`${tag} 2) Biblioteca: ${lib.length} pistas`);
        const selA = selectTrack("viral", "motivational", "test-A", 1000);
        const selB = selectTrack("viral", "motivational", "test-B", 2000);
        console.log(`${tag} 3) Selección A=${selA.track.id} B=${selB.track.id}`);
        console.log(`${tag} 4) Sintetizando ${selA.track.id} 8s…`);
        const trk = await renderTrack(selA.track, 8);
        await assertMusicAudio(trk.blob);
        console.log(`${tag}    OK · ${trk.bpm}bpm · ${trk.duration.toFixed(1)}s`);
        console.log(`${tag} 5) Mezcla voz+música…`);
        const wav = await mixVoiceAndMusic(null, trk.blob, { durationSec: 8, musicVolume: 0.14 });
        if (!wav) throw new Error("mezcla vacía");
        const st = await assertFinalAudio(wav);
        console.log(`${tag}    OK · RMS=${st.rms.toFixed(4)} dur=${st.duration.toFixed(1)}s`);
        console.log(`${tag} 6) Voz TTS real (en-US)…`);
        const v = await generateSpeech(settings, "This is a quick self test of your voice.", "en-US-f");
        console.log(`${tag}    OK · proveedor=${v.provider} · ${v.duration.toFixed(1)}s`);
        console.log(`${tag} ✅ TODO CORRECTO`);
        return true;
      } catch (e) {
        console.error(`${tag} ❌ FALLO:`, e);
        return false;
      }
    };
    return () => {
      delete (window as SelfTestWin).__ccSelfTest;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && busy === "creating") startKeepAlive();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const update = (patch: Partial<Project>) => {
    setProject((p) => {
      const next = { ...p, ...patch, updatedAt: new Date().toISOString() };
      saveProject(next);
      return next;
    });
  };

  const addLog = (msg: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} - ${msg}`]);

  // Recorta el guion para que la voz dure lo óptimo viral (~26s)
  function capForViral(text: string, maxChars: number): string {
    const t = text.trim();
    if (t.length <= maxChars) return t;
    const cut = t.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    return (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim();
  }


  function errText(e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|3gp)$/i.test(f.name)
    );
    if (!list.length) {
      setError("Formato no soportado. Usa MP4, MOV (galería del iPhone), WEBM o AVI.");
      return;
    }
    setError(null);
    setFinalUrl(null);
    setBusy("analyzing");
    setJobStage({ stage: "Leyendo vídeo", progress: 10 });
    if (!IS_MOBILE) void preloadKokoro(); // en escritorio: descarga la voz mientras preparas todo (móvil no la usa)

    try {
      const sources: SourceVideo[] = [];
      for (const file of list) {
        const url = URL.createObjectURL(file);
        const meta = await probeVideoMeta(url);
        sources.push({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type || "video/mp4",
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          hasAudio: meta.hasAudio,
        });
      }
      const main = sources[0];
      update({
        sources,
        name: main.name.replace(/\.[^.]+$/, ""),
        thumbnail: main.url,
        metadata: null,
      });
      setJobStage({ stage: "Vídeo cargado", progress: 100 });
      addLog(`Vídeo listo: ${main.name}`);
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    const src = project.sources[0];
    if (!src) {
      setError("Sube primero un vídeo.");
      return;
    }
    if (busy !== null) return;
    // Con voz: el enlace del producto es OBLIGATORIO
    if (voiceMode === "voz" && productUrl.trim().length <= 10) {
      setError("🛒 Pega el enlace del producto para generar la voz (o cambia a Solo música).");
      return;
    }
    setError(null);
    setFinalUrl(null);
    setVoiceWarning(null);
    setWatermarkDetected(false);
    setBusy("creating");
    await startKeepAlive();
    addLog("Creando tu vídeo viral...");

    try {
      const modoProducto = productUrl.trim().length > 10;
      // Motor de render en paralelo: se carga MIENTRAS se analiza/genera voz
      const ffLoading = isFfmpegLoaded() ? null : loadFfmpeg().catch(() => null);
      // 1. Análisis del contenido
      let meta: VideoMetadata = project.metadata || (null as unknown as VideoMetadata);
      if (!meta) {
        if (modoProducto) {
          meta = minimalMetadata(src);
          addLog("Modo producto: análisis de vídeo reducido (más rápido)");
        } else {
          setJobStage({ stage: "Analizando vídeo", progress: 6 });
          try {
            meta = await analyzeVideo(src, (st, p) =>
              setJobStage({ stage: `Analizando: ${st}`, progress: 6 + p * 12 })
            );
            addLog("Análisis completado");
          } catch {
            meta = minimalMetadata(src);
            addLog("Análisis básico aplicado");
          }
        }
      }

      // 2. Detección de marca de agua (primer vídeo)
      setJobStage({ stage: "Buscando momentos virales", progress: 11 });
      try {
        const wm = await detectWatermark(project.sources[0].url);
        setWatermarkDetected(wm);
        if (wm) {
          addLog("🚫 Se ha detectado marca de agua en el vídeo");
          setVoiceWarning("Se ha detectado marca de agua. Para quitarla, descarga el vídeo limpio con SnapTik y vuelve a subirlo.");
        }
      } catch {
        /* sin detección */
      }

      // 3. Momentos virales en TODOS los vídeos subidos
      const nVids = project.sources.length;
      setJobStage({ stage: `Buscando momentos virales (${nVids} vídeo${nVids > 1 ? "s" : ""})`, progress: 12 });
      type Seg = ViralSegment & { si: number };
      const allSegs: Seg[] = [];
      for (let si = 0; si < nVids; si++) {
        const s = project.sources[si];
        try {
          const segs = await detectViralHighlights(s, () => {});
          segs.forEach((g) => allSegs.push({ ...g, si }));
          addLog(`Vídeo ${si + 1}: ${segs.length} momento(s) con gancho`);
        } catch {
          addLog(`Vídeo ${si + 1}: detección omitida`);
        }
      }
      allSegs.sort((a, b) => b.score - a.score);

      // Elegir los mejores: máx 3 momentos, base corta para tiempo viral TikTok
      const picked: Seg[] = [];
      let tot = 0;
      for (const g of allSegs) {
        const d = g.end - g.start;
        if (picked.length >= 3 || tot + d > 22) continue;
        picked.push(g);
        tot += d;
      }
      if (!picked.length) {
        picked.push({ start: 0, end: Math.min(project.sources[0].duration || 15, 20), score: 0.8, si: 0 });
      }
      picked.sort((a, b) => a.si - b.si || a.start - b.start);
      addLog(
        picked.length > 1
          ? `Usando los ${picked.length} mejores momentos (${tot.toFixed(1)}s en total)`
          : "Usando el momento más fuerte"
      );

      // 3. Hooks y guion en inglés (o guion de producto desde enlace)
      setJobStage({ stage: modoProducto ? "Leyendo producto…" : "Generando hooks y guion", progress: 24 });
      let hooks: HookOption[] = [];
      let selectedHook = "";
      let script: ScriptSegment[] = [];
      if (modoProducto) {
        try {
          const info = await fetchProductInfo(productUrl.trim());
          setJobStage({ stage: "Creando guion del producto…", progress: 30 });
          script = await generateProductScript(settings, info);
          addLog("🛒 Guion del producto listo");
        } catch (e) {
          addLog(`Producto: ${errText(e)}`);
        }
      }
      if (!script.length) {
        try {
          hooks = await generateHooks(settings, meta.analysisText || "Short vertical video.");
        } catch {
          hooks = [];
        }
        if (!hooks.length) hooks = FALLBACK_HOOKS;
        selectedHook = hooks[0].text;
        try {
          script = await generateScript(settings, meta.analysisText || "Short vertical video.", hooks, selectedHook, project.style, project.goal);
        } catch {
          script = [];
        }
        if (!script.length) script = fallbackScript(selectedHook);
      }
      addLog(`Guion listo (${script.length} bloques)`);

      // 4. Voz — banda de progreso REAL 10→30 (nunca avanza sin terminar)
      let localVoiceUrl: string | null = null;
      let ttsBlob: Blob | null = null;
      let voiceDuration = 0;
      let lastVoiceError = "";
      if (voiceMode === "musica") {
        addLog("Modo solo música: sin voz");
      } else {
        const primeraVez = !IS_MOBILE && !(await isKokoroReady());
        setJobStage({
          stage: primeraVez ? "Descargando voz neuronal (solo la primera vez)" : "Generando voz",
          progress: 12,
        });
        {
          const fullText = capForViral(getScriptFullText({ ...project, script }), IS_IOS ? 140 : 400);
          if (fullText.trim()) {
            try {
              const voiceT0 = Date.now();
              addLog(`[VOZ] ${fullText.length} caracteres · ${IS_MOBILE ? "proveedores en la nube" : "Kokoro local"}`);
              let lastDone = 0;
              let lastTotal = 1;
              // Latido visible cada segundo: nunca se queda congelado sin información
              const beat = setInterval(() => {
                const el = Math.round((Date.now() - voiceT0) / 1000);
                const dl = voicePctRef.current;
                if (!IS_MOBILE && lastDone === 0 && dl !== null && dl < 100) {
                  setJobStage({
                    stage: `⬇️ Descargando voz… ${dl}% · ${el}s transcurridos`,
                    progress: Math.min(14, 12 + dl! * 0.02),
                  });
                  return;
                }
                setJobStage({
                  stage: `🎙️ Generando voz… ${el}s transcurridos${lastDone ? ` (${lastDone}/${lastTotal} frases)` : ""}`,
                  progress: Math.min(28, 12 + (lastDone / Math.max(1, lastTotal)) * 16),
                });
              }, 1000);
              // Tope duro por intento: la promesa SIEMPRE se resuelve
              const VOICE_CAP_MS = IS_MOBILE ? 75000 : 250000;
              const attempt = async (t: string): Promise<Awaited<ReturnType<typeof generateSpeech>> | null> =>
                Promise.race([
                  generateSpeech(settings, t, settings.ttsVoiceId || "en-US-f", {
                    speed: 1,
                    onProgress: (done, total) => {
                      lastDone = done;
                      lastTotal = total;
                      const el = (Date.now() - voiceT0) / 1000;
                      const eta = Math.max(1, Math.round((el / Math.max(1, done)) * (total - done)));
                      setJobStage({
                        stage: `🎙️ Generando voz ${done}/${total} · quedan ~${eta}s`,
                        progress: Math.min(29, 12 + (done / total) * 17),
                      });
                    },
                  }),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), VOICE_CAP_MS)),
                ]);
              let voice: Awaited<ReturnType<typeof generateSpeech>> | null = null;
              try {
                voice = await attempt(fullText);
                if (!voice && fullText.length > 90) {
                  addLog("Voz lenta: reintentando con texto más corto");
                  voice = await attempt(`${fullText.slice(0, 88)}.`);
                }
              } finally {
                clearInterval(beat);
              }
              if (!voice) throw new Error(`La voz no respondió en ${Math.round(VOICE_CAP_MS / 1000)}s`);
              addLog(`[VOZ] Lista vía ${voice.provider} en ${((Date.now() - voiceT0) / 1000).toFixed(1)}s`);
              // Validación REAL del audio de voz antes de seguir
              const vst = await assertVoiceAudio(voice.blob);
              ttsBlob = voice.blob;
              localVoiceUrl = voice.url;
              voiceDuration = voice.duration || vst.duration;
              addLog(`Voz OK (${voiceDuration.toFixed(1)}s · RMS ${vst.rms.toFixed(3)})`);
              setJobStage({ stage: "Voz lista", progress: 30 });
            } catch (e) {
              lastVoiceError = errText(e);
              addLog(`Voz: ${lastVoiceError}`);
            }
          }
        }
      }

      // 5. Subtítulos desde la voz
      let cues: Project["subtitles"]["cues"] = [];
      if (ttsBlob && serviceStatus(settings, "stt").configured) {
        setJobStage({ stage: "Generando subtítulos", progress: 31 });
        try {
          cues = await transcribeWithTimestamps(settings, ttsBlob);
          addLog(`Subtítulos: ${cues.length} bloques`);
        } catch {
          addLog("Subtítulos omitidos");
        }
      }

      // Aviso visible si la voz no se pudo generar, con el motivo real para diagnosticar
      if (voiceMode === "voz" && !localVoiceUrl) {
        const motivo = lastVoiceError ? ` Motivo: ${lastVoiceError.slice(0, 160)}` : "";
        const msg = `No se pudo generar la voz. El vídeo se creará con música de fondo.${motivo}`;
        setVoiceWarning((prev) => (prev ? `${prev} ${msg}` : msg));
      }

      // Modo voz con voz fallida: subtítulos generados desde el GUION repartidos
      // en el tiempo (en modo música NO se pintan textos)
      if (!cues.length && voiceMode === "voz" && script.length && picked.length) {
        const estDur = Math.max(6, Math.min(24, picked.reduce((a, g) => a + (g.end - g.start), 0)));
        const lines: string[] = [];
        for (const seg of script) {
          const words = seg.text.trim().split(/\s+/);
          for (let i = 0; i < words.length; i += 4) lines.push(words.slice(i, i + 4).join(" "));
        }
        const per = estDur / Math.max(1, lines.length);
        cues = lines.map((t, idx) => ({
          text: t,
          start: idx * per,
          end: (idx + 1) * per,
          words: [{ word: t, start: idx * per, end: (idx + 1) * per }],
        }));
        addLog(`Subtítulos desde guion (${cues.length} bloques)`);
      }

      // ⏱️ Tiempo perfecto para TikTok: los clips se ajustan exactos a la voz
      if (voiceMode === "voz" && localVoiceUrl && picked.length && voiceDuration > 0) {
        let clipsDur = picked.reduce((a, g) => a + (g.end - g.start), 0);
        const target = Math.min(34, Math.max(12, voiceDuration + 0.8));
        if (clipsDur > target + 1) {
          // Sobra vídeo: quitar momentos desde el final y recortar el último
          while (picked.length > 1) {
            const d = picked[picked.length - 1].end - picked[picked.length - 1].start;
            if (clipsDur - d >= target - 1) {
              clipsDur -= d;
              picked.pop();
            } else break;
          }
          const lastT = picked[picked.length - 1];
          const excess = clipsDur - target;
          if (excess > 0.3 && lastT.end - lastT.start - excess > 2.5) {
            lastT.end = Math.round((lastT.end - excess) * 100) / 100;
          }
          addLog(`⏱️ Vídeo ajustado a ${target.toFixed(0)}s para máxima retención`);
        } else if (voiceDuration > clipsDur + 0.5) {
          // Falta vídeo: estirar el último momento (tope absoluto 38s)
          const last = picked[picked.length - 1];
          const srcDur = project.sources[last.si]?.duration || meta.duration || 0;
          const wantTotal = Math.min(voiceDuration + 0.6, 38);
          const wantEnd = Math.min(srcDur || Infinity, last.end + (wantTotal - clipsDur));
          if (wantEnd > last.end) {
            last.end = Math.round(wantEnd * 100) / 100;
            addLog(`Último momento extendido hasta ${formatTime(last.end)} para cubrir la voz`);
          }
        }
        const finalDur = picked.reduce((a, g) => a + (g.end - g.start), 0);
        addLog(`🎯 Duración final: ${finalDur.toFixed(0)}s (zona viral de TikTok)`);
      } else if (voiceMode === "musica" && picked.length) {
        // Solo música: loop corto ideal para retención
        let clipsDur = picked.reduce((a, g) => a + (g.end - g.start), 0);
        const target = Math.min(picked[0].end - picked[0].start > 20 ? 20 : clipsDur, clipsDur);
        while (picked.length > 1 && clipsDur > 24) {
          const d = picked[picked.length-1].end - picked[picked.length-1].start;
          if (clipsDur - d >= 18) { clipsDur -= d; picked.pop(); } else break;
        }
        void target;
      }

      // 6. Plan de edición con los momentos virales de todos los vídeos
      setJobStage({ stage: "Preparando edición", progress: 65 });
      const base: Project = {
        ...project,
        metadata: {
          ...meta,
          scenes: picked.map((g) => ({
            start: Math.max(0, g.start),
            end: g.end,
            score: g.score || 0.9,
            type: "action" as const,
            sourceId: project.sources[g.si].id,
          })),
        },
        hooks,
        selectedHook,
        script,
        subtitles: { ...project.subtitles, cues },
        voice: localVoiceUrl ? project.voice : project.voice,
      };
      // 🎵 Música AUTOMÁTICA (el usuario nunca elige): clasificador por scoring →
      // selector anti-repetición → pista procedural única de la biblioteca de 100
      let autoMusicBlob: Blob | null = null;
      {
        setJobStage({ stage: "Eligiendo música…", progress: 31 });
        try {
          const estDur = Math.max(8, Math.min(38, picked.reduce((a, g) => a + (g.end - g.start), 0)));
          const cls = classifyMusic({
            scriptText: script.map((s) => s.text).join(" "),
            projectStyle: project.style,
            goal: project.goal,
            durationSec: estDur,
          });
          addLog(
            `[MÚSICA] Clasificación: ${cls.primaryCategory} (+${cls.secondaryCategory}) · energía ${cls.energy} · confianza ${cls.confidence}`
          );
          setJobStage({ stage: "Eligiendo música…", progress: 33 });
          const sel = selectTrack(cls.primaryCategory, cls.secondaryCategory, project.id || `p${Date.now()}`);
          addLog(`[MÚSICA] Pista seleccionada: ${sel.track.id}`);
          setJobStage({ stage: `Componiendo música (${sel.track.id})…`, progress: 36 });
          const rendered = await renderTrack(sel.track, estDur);
          // Validación REAL: nada de exportar una pista muda
          await assertMusicAudio(rendered.blob);
          autoMusicBlob = rendered.blob;
          base.music = {
            id: sel.track.id,
            name: `${sel.track.id} · ${rendered.bpm}bpm`,
            duration: rendered.duration,
            bpm: rendered.bpm,
            category: sel.track.category,
            url: rendered.url,
          };
          addLog(`[MÚSICA] Lista: ${sel.track.id} · ${rendered.bpm}bpm · ${rendered.duration.toFixed(0)}s`);
        } catch (e) {
          addLog(`[MÚSICA] Falló la preparación: ${errText(e)}`);
        }
      }
      setJobStage({ stage: "Música lista", progress: 40 });

      const plan = buildEditPlan(base);
      if (localVoiceUrl) {
        plan.voice = {
          audioUrl: localVoiceUrl,
          duration: voiceDuration || cues[cues.length - 1]?.end || plan.duration,
          volume: 1,
        };
      }
      // Modo solo música: silenciar el audio original para que se oiga SOLO la canción
      if (voiceMode === "musica") {
        plan.audio.originalVolume = 0;
      }
      // Voz pedida pero falló: dejar el vídeo limpio (solo música), nunca audio original cortado
      if (!localVoiceUrl && voiceMode === "voz") {
        plan.audio.originalVolume = 0;
      }
      // Con voz: bajar la música para que no tape la narración (mejor calidad percibida)
      if (localVoiceUrl) {
        plan.audio.musicVolume = Math.min(plan.audio.musicVolume ?? 0.25, 0.16);
      }
      const next: Project = { ...base, editPlan: plan, status: "ready" };
      setProject(next);
      saveProject(next);

      // 7. Render final MP4
      setJobStage({ stage: "Preparando el render", progress: 70 });
      const onStage = (st: string, p: number) =>
        setJobStage({ stage: st, progress: Math.min(99, Math.max(10, p)) });
      let result;
      if (IS_IOS) {
        // iPhone/iPad: grabación NATIVA (imagen), banda de progreso 55→90
        const mapP = (p: number) => 55 + Math.max(0, Math.min(100, p)) * 0.35;
        let lastErr: unknown = null;
        let okAttempt: Awaited<ReturnType<typeof renderProjectMobile>> | null = null;
        for (let attempt = 0; attempt < 2 && !okAttempt; attempt++) {
          try {
            if (attempt > 0) {
              addLog("Repetimos la grabación nativa…");
              setJobStage({ stage: "Repetimos la grabación…", progress: 55 });
            }
            okAttempt = await renderProjectMobile(next, {
              width: 540,
              height: 960,
              fps: 30,
              musicVolume: plan.audio.musicVolume ?? 0.25,
              voiceVolume: plan.audio.voiceVolume ?? 1,
              onStage: (s, p) => onStage(s, mapP(p)),
            });
          } catch (e) {
            lastErr = e;
          }
        }
        if (!okAttempt) throw lastErr instanceof Error ? lastErr : new Error("grabación fallida");
        // MEZCLA REAL voz+música (banda 40→55): OfflineAudioContext determinista y
        // unión al vídeo sin re-codificar imagen. Pipeline principal, no un plan B.
        setJobStage({ stage: "Mezclando voz y música…", progress: 46 });
        const wav = await mixVoiceAndMusic(ttsBlob, autoMusicBlob, {
          durationSec: okAttempt.validation.duration,
          voiceVolume: plan.audio.voiceVolume ?? 1,
          musicVolume: Math.min(plan.audio.musicVolume ?? 0.14, 0.18),
        });
        if (wav && okAttempt.validation.hasAudio) {
          await assertMusicAudio(wav);
          addLog("Uniendo vídeo y sonido…");
          setJobStage({ stage: "Uniendo vídeo y sonido…", progress: 52 });
          if (!isFfmpegLoaded()) await loadFfmpeg();
          const ff = getFfmpeg();
          const vExt = okAttempt.blob.type.includes("webm") ? "webm" : "mp4";
          await ff.writeFile("mv." + vExt, new Uint8Array(await okAttempt.blob.arrayBuffer()));
          await ff.writeFile("st.wav", new Uint8Array(await wav.arrayBuffer()));
          await ff.exec([
            "-i", "mv." + vExt, "-i", "st.wav",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
            "-shortest", "-movflags", "+faststart", "-y", "final_av.mp4",
          ]);
          const out = await ff.readFile("final_av.mp4");
          const bytes =
            typeof out === "string" ? new TextEncoder().encode(out) : new Uint8Array(out);
          const nb = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
          URL.revokeObjectURL(okAttempt.url);
          okAttempt = {
            ...okAttempt,
            blob: nb,
            url: URL.createObjectURL(nb),
            validation: {
              ...okAttempt.validation,
              sizeBytes: nb.size,
              codec: "h264/aac",
            },
          };
        }
        result = okAttempt;
      } else {
        // Escritorio: motor completo (máxima calidad), banda 55→90
        setJobStage({ stage: "Cargando motor de vídeo (solo la primera vez)", progress: 56 });
        if (!isFfmpegLoaded()) {
          if (ffLoading) await ffLoading;
          else await loadFfmpeg();
        }
        try {
          result = await renderProject(getFfmpeg(), next, {
            targetWidth: 1080,
            targetHeight: 1920,
            fps: 24,
            crf: 18,
            onStage,
          });
        } catch {
          addLog("⚠️ Reintentando en modo ligero…");
          setJobStage({ stage: "Reintentando en modo ligero", progress: 70 });
          await resetFfmpeg();
          await loadFfmpeg();
          result = await renderProject(getFfmpeg(), next, {
            targetWidth: 540,
            targetHeight: 960,
            fps: 24,
            crf: 26,
            onStage,
          });
        }
      }

      // 🔎 Verificación FINAL del audio (banda 90→100): nada sale sin sonido
      setJobStage({ stage: "Verificando sonido final…", progress: 92 });
      try {
        const st = await assertFinalAudio(result.blob);
        addLog(
          `[VERIFICACIÓN] Audio OK · RMS=${st.rms.toFixed(4)} pico=${st.peak.toFixed(2)} dur=${st.duration.toFixed(1)}s`
        );
      } catch (e) {
        throw new Error(`Audio final inválido: ${errText(e)}`);
      }

      setJobStage({ stage: "Finalizando…", progress: 97 });
      update({ renderUrl: result.url, renderValidation: result.validation, status: "exported" });
      setFinalUrl(result.url);
      setJobStage({ stage: "¡Tu vídeo está listo!", progress: 100 });
      addLog(
        `✅ Vídeo final: ${(result.validation.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${Math.round(result.validation.duration)}s`
      );
    } catch (e) {
      setError(errText(e));
      addLog(`Error: ${errText(e)}`);
    } finally {
      stopKeepAlive();
      setBusy(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const hasSource = project.sources.length > 0;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold">Crear vídeo viral</h1>
        <p className="text-sm text-gray-400 mt-1">
          Sube tu vídeo, pulsa el botón y descarga tu vídeo terminado.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200" aria-label="Cerrar">
              ✕
            </button>
          </div>
        )}

        {voiceWarning && (
          <div className={`mt-4 rounded-lg border p-3 text-sm ${watermarkDetected ? "border-orange-500/40 bg-orange-500/10 text-orange-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
            {watermarkDetected ? "🚫 " : "⚠️ "}
            {voiceWarning}
            {watermarkDetected && (
              <a
                href="https://snaptik.me/es"
                target="_blank"
                rel="noreferrer"
                className="mt-2 block w-fit rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400"
              >
                Abrir SnapTik ↗
              </a>
            )}
          </div>
        )}

        {jobStage && (
          <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex justify-between text-sm text-blue-200">
              <span>{busy === "creating" ? "🚀" : "📱"} {jobStage.stage}</span>
              <span>{Math.round(jobStage.progress)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-900/50 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${jobStage.progress}%` }} />
            </div>
          </div>
        )}

        {busy === "creating" && (
          <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            📱 Mantén esta pestaña abierta y la pantalla encendida mientras se crea el vídeo (en iPhone, iOS pausa el trabajo si cambias de app).
          </div>
        )}

        {/* 1 · Subir */}
        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !busy && fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && !busy && fileInput.current?.click()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
              dragging ? "border-blue-500 bg-blue-500/10" : "border-white/15 hover:border-blue-400/50"
            }`}
          >
            <span className="text-3xl">📱</span>
            <span className="mt-2 text-sm">{hasSource ? "Añadir más vídeos" : "Toca para elegir de tu galería"}</span>
            <span className="mt-1 text-xs text-gray-400">Puedes subir varios · MP4 · MOV · WEBM</span>
            <input
              ref={fileInput}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          {project.sources.map((s) => (
            <div key={s.id} className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
              <video src={s.url} muted playsInline preload="metadata" className="h-14 w-10 rounded object-cover bg-black" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{s.name}</div>
                <div className="text-xs text-gray-400">
                  {s.duration > 0 ? `${s.duration.toFixed(1)}s` : ""}
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* Guía SnapTik */}
        {!hasSource && (
          <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold">¿El vídeo es de TikTok?</h2>
            <p className="text-xs text-gray-400 mt-1">
              Descárgalo SIN marca de agua antes de subirlo:
            </p>
            <ol className="mt-3 space-y-1.5 text-xs text-gray-300 list-decimal list-inside">
              <li>En TikTok: pulsa <strong>Compartir → Copiar enlace</strong></li>
              <li>Abre snaptik.me y pega el enlace</li>
              <li>Descarga la opción <strong>"Sin marca de agua"</strong> y súbelo aquí</li>
            </ol>
            <a
              href="https://snaptik.me/es"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
            >
              Abrir SnapTik ↗
            </a>
          </section>
        )}

        {/* Modo audio + selector de voz */}
        {hasSource && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>Audio:</span>
              <button
                onClick={() => setVoiceMode("voz")}
                className={`rounded-full px-3 py-1 transition-colors ${
                  voiceMode === "voz" ? "bg-blue-600 text-white" : "bg-white/10 hover:bg-white/15"
                }`}
              >
                🎙️ Con voz
              </button>
              <button
                onClick={() => setVoiceMode("musica")}
                className={`rounded-full px-3 py-1 transition-colors ${
                  voiceMode === "musica" ? "bg-emerald-600 text-white" : "bg-white/10 hover:bg-white/15"
                }`}
              >
                🎵 Solo música
              </button>
            </div>

            {voiceMode === "voz" && (
              <div className="mt-3">
                <label className="text-xs font-semibold text-gray-300">
                  🛒 Enlace del producto (obligatorio para la voz)
                </label>
                <input
                  type="url"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="https://es.aliexpress.com/item/100500xxxxx.html"
                  disabled={busy !== null}
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-fuchsia-500 disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  La voz contará ese producto (guion ultra-rápido). En Solo música no hace falta.
                </p>
              </div>
            )}
          </div>
        )}

        {/* EL BOTÓN ÚNICO */}
        <button
          onClick={handleCreate}
          disabled={busy !== null || !hasSource}
          className={`mt-5 w-full rounded-xl px-6 py-5 text-lg font-bold transition-colors ${
            busy === "creating"
              ? "bg-fuchsia-600/60 cursor-wait animate-pulse-soft"
              : !hasSource
                ? "bg-white/5 text-gray-400 cursor-not-allowed"
                : "bg-fuchsia-600 hover:bg-fuchsia-500 shadow-lg shadow-fuchsia-900/40"
          }`}
        >
          {busy === "creating" ? "Creando tu vídeo viral…" : hasSource && finalUrl ? "🔁 Generar otro vídeo viral" : "🚀 Generar vídeo viral"}
        </button>

        {/* Resultado */}
        {finalUrl && (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="text-sm font-semibold text-emerald-300 mb-3">🎉 ¡Aquí está tu vídeo viral!</div>
            <video src={finalUrl} controls playsInline className="w-full rounded-lg max-h-[60vh] bg-black" />
            <a
              href={finalUrl}
              download={`${project.name || "clip-viral"}.mp4`}
              className="block mt-3 text-center rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold hover:bg-emerald-500"
            >
              ⬇️ Descargar MP4
            </a>
            <Link href={`/editor?id=${project.id}`} className="block mt-2 text-center text-xs text-blue-400 hover:text-blue-300">
              Ajustes avanzados en el editor →
            </Link>
          </div>
        )}

        {log.length > 0 && (
          <details className="mt-6 rounded-xl border border-white/10 p-4">
            <summary className="text-xs text-gray-500 cursor-pointer">Registro de actividad</summary>
            <pre className="mt-2 text-[11px] text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {log.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </AppShell>
  );
}

async function probeVideoMeta(url: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}> {
  return new Promise((resolve) => {
    const fallback = { duration: 0, width: 0, height: 0, fps: 30, hasAudio: true };
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const finish = (val: typeof fallback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    timer = setTimeout(() => finish(fallback), 8000);
    video.onloadedmetadata = () => {
      const dur = video.duration;
      if (isFinite(dur) && dur > 0) {
        finish({
          duration: dur,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          hasAudio: true,
        });
        return;
      }
      video.onseeked = () => {
        const d2 = video.duration;
        finish({
          duration: isFinite(d2) ? d2 : 0,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          hasAudio: true,
        });
      };
      try {
        video.currentTime = 1e6;
      } catch {
        finish({
          duration: 0,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          fps: 30,
          hasAudio: true,
        });
      }
    };
    video.onerror = () => finish(fallback);
    video.src = url;
  });
}

function minimalMetadata(src: SourceVideo): VideoMetadata {
  const duration = src.duration || 10;
  return {
    scenes: [],
    duration,
    resolution: { width: src.width || 1080, height: src.height || 1920 },
    fps: src.fps || 30,
    people: 0,
    objects: ["contenido visual"],
    speech: 0,
    silenceSegments: [],
    sceneChanges: 0,
    interestingSegments: [],
    audioLevel: 0,
    qualityScore: 70,
    analysisText: `Vídeo de ${duration.toFixed(1)}s listo para edición vertical.`,
  };
}

function formatTime(t: number): string {
  if (!t || !isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function validateVoiceBlob(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(isFinite(audio.duration) && audio.duration > 0.5);
    audio.onerror = () => resolve(false);
    audio.src = url;
  });
}
