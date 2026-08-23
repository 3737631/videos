/**
 * PIPELINE V3 — orquestador con fases REALES, timeout, reintento y limpieza.
 * GUION → Analizar idioma/estilo → Seleccionar voz → Obtener voz
 *       → Generar música → Subtítulos → Mezcla → Render → Verificación → Exportar
 */
import { createProgressTracker, type StageName } from "@/lib/progress";
import { toFriendlyError, TimeoutError } from "@/lib/net";
import { detectNiche, NICHE_PALETTES, suggestedSpeechRate, suggestedCTA, type NicheInfo } from "@/lib/niche";
import { buildSubtitles } from "@/lib/subtitles";
import {
  defaultVoiceForLocale,
  getVoiceById,
} from "@/lib/voices/catalog";
import {
  ensureVoiceInstalled,
  synthesizeProsodyWithFallback,
  blobDuration,
} from "@/lib/voices/engine";
import { recommendStyle, getStyle } from "@/lib/script/styles";
import { correctiveSpeed } from "@/lib/script/generator";
import { classifyMusic } from "@/lib/audio/musicClassifier";
import { selectTrack } from "@/lib/audio/musicSelector";
import { renderTrack } from "@/lib/audio/musicLibrary";
import { mixVoiceAndMusic } from "@/lib/audio/audioMixer";
import { assertFinalAudio } from "@/lib/audio/validation";
import { renderCaptionsVideo } from "@/lib/video/canvasRender";

export interface CreationInput {
  script: string;
  voiceId?: string | null;
  onlyMusic?: boolean;
  targetSeconds?: number;
  /** Estilo de entonación (natural, viral, urgente…) */
  styleId?: string;
  /** Duración del vídeo fuente a la que debe encajar la voz */
  targetDurationSec?: number;
  /** Tolerancia del ajuste de duración (def. 0.25 s) */
  toleranceSec?: number;
}

export interface CreationResult {
  projectId: string;
  name: string;
  blob: Blob;
  url: string;
  ext: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  thumbnail: string;
  voiceId: string | null;
  voiceName: string | null;
  usedFallback: boolean;
  musicTrackName: string | null;
  cuesCount: number;
  niche: NicheInfo;
  errors: string[];
  styleId: string | null;
  targetSeconds: number | null;
}

export interface PipelineHandlers {
  onStage: (stage: StageName, label: string, pct: number, etaSec?: number | null) => void;
  signal?: AbortSignal;
}

const STAGE_TIMEOUT_MS: Partial<Record<StageName, number>> = {
  ANALYZING_SCRIPT: 10000,
  GENERATING_VOICE: 300000,
  GENERATING_MUSIC: 60000,
  CREATING_SUBTITLES: 15000,
  MIXING_AUDIO: 120000,
  RENDERING: 420000,
  VERIFYING: 60000,
};

/** Ejecuta fn con timeout + reintentos; cleanup SIEMPRE al final de cada intento */
export async function runStage<T>(
  name: Exclude<StageName, "ERROR" | "DONE">,
  fn: (signal: AbortSignal) => Promise<T>,
  h: PipelineHandlers,
  tracker: ReturnType<typeof createProgressTracker>,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  tracker.set(name);
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort(h.signal?.reason);
    if (h.signal) {
      if (h.signal.aborted) throw new DOMException("cancelado", "AbortError");
      h.signal.addEventListener("abort", onOuterAbort, { once: true });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = fn(ctrl.signal);
      const guard = opts.timeoutMs
        ? new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new TimeoutError(opts.timeoutMs!)), opts.timeoutMs);
          })
        : null;
      return await (guard ? Promise.race([work, guard]) : work);
    } catch (err) {
      lastErr = err;
      if (h.signal?.aborted || err instanceof DOMException) throw err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500));
    } finally {
      if (timer) clearTimeout(timer);
      h.signal?.removeEventListener("abort", onOuterAbort);
      ctrl.abort();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Fallo en la fase " + name);
}

// ── Detección de idioma del guion (heurística offline) ──────────────────
const LANG_HINTS: Record<string, string[]> = {
  es: ["el", "la", "los", "las", "que", "para", "con", "este", "esta", "tu", "porque", "gratis", "ahora", "mira"],
  en: ["the", "this", "that", "with", "your", "you", "and", "for", "wait", "look", "best", "free"],
  fr: ["le", "la", "les", "cette", "avec", "pour", "regarde", "voici", "gratuit", "votre"],
  de: ["der", "die", "das", "und", "mit", "für", "schau", "dieses", "kostenlos", "jetzt"],
  it: ["il", "lo", "la", "che", "con", "questo", "guarda", "gratis", "ora", "tuo"],
  pt: ["o", "a", "os", "as", "que", "com", "para", "olha", "esse", "grátis", "agora"],
};

export function detectScriptLang(text: string): string {
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const score: Record<string, number> = {};
  for (const w of words) {
    for (const [lang, hints] of Object.entries(LANG_HINTS)) {
      if (hints.includes(w)) score[lang] = (score[lang] || 0) + 1;
    }
  }
  let best = "es";
  let bestN = -1;
  for (const [lang, n] of Object.entries(score)) {
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  return best;
}

/**
 * Pipeline completo. Lanza errores ya humanizados (toFriendlyError).
 */
export async function runCreationPipeline(
  input: CreationInput,
  h: PipelineHandlers
): Promise<CreationResult> {
  const tracker = createProgressTracker(h.onStage);
  const projectId = crypto.randomUUID();
  let voiceBlob: Blob | null = null;
  let mixBlob: Blob | null = null;
  // Holder evita el estrechamiento de tipos de TS en cierres asíncronos
  const music: {
    trackId: string | null;
    label: string | null;
    blob: Blob | null;
    duration: number | null;
    url: string | null;
  } = { trackId: null, label: null, blob: null, duration: null, url: null };
  try {
    tracker.set("PREPARING");
    const script = input.script.trim();
    if (!script && !input.onlyMusic) throw new Error("Escribe el guion de tu anuncio primero.");

    // ── Analizar guion ─────────────────────────────────────────────────
    const nicheInfo = await runStage(
      "ANALYZING_SCRIPT",
      async () => detectNiche(script),
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.ANALYZING_SCRIPT, retries: 0 }
    );
    const lang = detectScriptLang(script);
    const palette = NICHE_PALETTES[nicheInfo.niche];
    // Tono: el elegido por el usuario o el recomendado automáticamente
    const styleId =
      getStyle(input.styleId).id === input.styleId
        ? (input.styleId as string)
        : recommendStyle({
            scriptText: script,
            isDropshipping: nicheInfo.isDropshipping,
            durationSec: input.targetDurationSec ?? null,
          });
    const validationWarnings: string[] = [];

    // ── Seleccionar voz ────────────────────────────────────────────────
    let chosenId =
      input.voiceId && getVoiceById(input.voiceId)
        ? input.voiceId
        : defaultVoiceForLocale(lang + "-XX");
    if (!input.onlyMusic) {
      await runStage(
        "GENERATING_VOICE", // la descarga de la voz pertenece a esta fase
        async () => {
          await ensureVoiceInstalled(chosenId, { signal: h.signal });
        },
        h, tracker, { timeoutMs: 600000, retries: 0 }
      );
    }

    // ── Generar voz (entonación por segmentos + ajuste a duración) ─────
    let voiceDuration: number | null = null;
    let usedFallback = false;
    const segTimings: Array<{ text: string; start: number; end: number }> = [];
    if (!input.onlyMusic) {
      const target = input.targetDurationSec ?? input.targetSeconds ?? null;
      const tol = input.toleranceSec ?? 0.25;
      const baseSpeed = suggestedSpeechRate(nicheInfo);
      let attemptSpeed = baseSpeed;
      let best: Awaited<ReturnType<typeof synthesizeProsodyWithFallback>> | null = null;

      for (let round = 0; round < 2; round++) {
        const res = await runStage(
          "GENERATING_VOICE",
          async (signal) => {
            return await synthesizeProsodyWithFallback(script, chosenId, {
              signal,
              speed: attemptSpeed,
              styleId,
              onProgress: (p) => tracker.set("GENERATING_VOICE", p ?? undefined),
            });
          },
          h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.GENERATING_VOICE, retries: 0 }
        );
        best = res;
        voiceDuration = await blobDuration(res.blob);
        chosenId = res.voiceId;
        usedFallback = res.usedFallback;
        if (!target || round === 1) break;
        const mul = correctiveSpeed(voiceDuration, target, tol);
        if (!mul) break; // ya encaja
        attemptSpeed = Math.min(1.5, Math.max(0.7, attemptSpeed * mul));
      }
      if (best) {
        segTimings.push(...best.timings);
        if (
          target &&
          voiceDuration &&
          Math.abs(voiceDuration - target) > Math.max(tol, 0.8)
        ) {
          validationWarnings.push(
            `La voz mide ${voiceDuration.toFixed(1)} s y el vídeo ${target.toFixed(1)} s`
          );
        }
      }
    }

    // ── Generar música ─────────────────────────────────────────────────
    await runStage(
      "GENERATING_MUSIC",
      async (signal) => {
        const cls = classifyMusic({
          scriptText: script,
          projectStyle: styleId,
          goal: "ventas",
          durationSec: Math.round(voiceDuration ?? input.targetDurationSec ?? input.targetSeconds ?? 15),
        });
        const sel = selectTrack(cls.primaryCategory, cls.secondaryCategory, projectId);
        const secs = Math.max(8, voiceDuration ?? input.targetSeconds ?? 15);
        const rendered = await renderTrack(sel.track, secs, undefined);
        music.trackId = sel.track.id;
        music.label = `${sel.track.category} · ${rendered.bpm} BPM`;
        music.blob = rendered.blob;
        music.duration = rendered.duration;
        music.url = rendered.url;
        if (signal.aborted) throw new DOMException("cancelado", "AbortError");
      },
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.GENERATING_MUSIC }
    ).catch((err) => {
      // La música no debe tumbar el vídeo: seguimos sin ella
      console.warn("música omitida:", err);
    });

    // ── Subtítulos (anclados a timestamps REALES de la voz) ────────────
    const subs = await runStage(
      "CREATING_SUBTITLES",
      async () =>
        buildSubtitles(script, voiceDuration, {
          niche: nicheInfo.niche,
          segTimings: input.onlyMusic ? undefined : segTimings,
        }),
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.CREATING_SUBTITLES, retries: 0 }
    );

    // ── Mezcla ─────────────────────────────────────────────────────────
    mixBlob = await runStage(
      "MIXING_AUDIO",
      async () => {
        const target = voiceDuration ?? music.duration ?? 15;
        return await mixVoiceAndMusic(voiceBlob, music.blob, {
          durationSec: target,
          musicVolume: voiceBlob ? 0.14 : 0.9,
          voiceVolume: 1,
        });
      },
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.MIXING_AUDIO }
    );

    const durationSec = Math.max(3, voiceDuration ?? music.duration ?? 15);

    // ── Render (canvas + MediaRecorder) ────────────────────────────────
    const isMobileLike =
      typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const width = isMobileLike ? 720 : 1080;
    const height = isMobileLike ? 1280 : 1920;
    const rendered = await runStage(
      "RENDERING",
      async (signal) => {
        return await renderCaptionsVideo({
          durationSec,
          audioBlob: mixBlob,
          cues: subs.cues,
          style: subs.style,
          palette,
          width,
          height,
          fps: isMobileLike ? 30 : 30,
          signal,
          onPct: (p) => tracker.set("RENDERING", p),
        });
      },
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.RENDERING, retries: isMobileLike ? 2 : 1 }
    );

    // ── Verificación ───────────────────────────────────────────────────
    const validation = await runStage(
      "VERIFYING",
      async () => {
        const stats = await assertFinalAudio(rendered.blob);
        const errors: string[] = [];
        if (!stats.valid || stats.rms < 0.0005) errors.push("El audio final suena vacío");
        if (Math.abs(stats.duration - durationSec) > 1.5) errors.push("Duración inesperada");
        return errors;
      },
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.VERIFYING }
    );

    // ── Exportar ───────────────────────────────────────────────────────
    tracker.set("EXPORTING");
    const voiceMeta = chosenId ? getVoiceById(chosenId) : null;
    const result: CreationResult = {
      projectId,
      name: script.slice(0, 42) || "Anuncio musical",
      blob: rendered.blob,
      url: rendered.url,
      ext: rendered.ext,
      duration: durationSec,
      width,
      height,
      fps: 30,
      thumbnail: rendered.thumbnail,
      voiceId: input.onlyMusic ? null : chosenId,
      voiceName: input.onlyMusic ? null : voiceMeta?.name ?? null,
      usedFallback,
      musicTrackName: music.label,
      cuesCount: subs.cues.length,
      niche: nicheInfo,
      errors: [...validation, ...validationWarnings],
      styleId: input.onlyMusic ? null : styleId,
      targetSeconds: input.targetDurationSec ?? input.targetSeconds ?? null,
    };
    tracker.done();
    return result;
  } catch (err) {
    tracker.fail();
    if (music.url) URL.revokeObjectURL(music.url);
    throw new Error(toFriendlyError(err));
  }
}

