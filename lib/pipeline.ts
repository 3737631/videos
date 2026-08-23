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
  synthesizeWithFallback,
  blobDuration,
} from "@/lib/voices/engine";
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
}

export interface PipelineHandlers {
  onStage: (stage: StageName, label: string, pct: number) => void;
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
    const speed = suggestedSpeechRate(nicheInfo);

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

    // ── Generar voz ────────────────────────────────────────────────────
    let voiceDuration: number | null = null;
    let usedFallback = false;
    if (!input.onlyMusic) {
      const fullText = script;
      const res = await runStage(
        "GENERATING_VOICE",
        async (signal) => {
          return await synthesizeWithFallback(fullText, chosenId, {
            signal,
            speed,
            onProgress: (p) => tracker.set("GENERATING_VOICE", p ?? undefined),
          });
        },
        h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.GENERATING_VOICE, retries: 0 }
      );
      voiceBlob = res.blob;
      voiceDuration = await blobDuration(voiceBlob);
      chosenId = res.voiceId;
      usedFallback = res.usedFallback;
    }

    // ── Generar música ─────────────────────────────────────────────────
    await runStage(
      "GENERATING_MUSIC",
      async (signal) => {
        const cls = classifyMusic({ scriptText: script });
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

    // ── Subtítulos ─────────────────────────────────────────────────────
    const subs = await runStage(
      "CREATING_SUBTITLES",
      async () => buildSubtitles(script, voiceDuration, { niche: nicheInfo.niche }),
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
      errors: validation,
    };
    tracker.done();
    return result;
  } catch (err) {
    tracker.fail();
    if (music.url) URL.revokeObjectURL(music.url);
    throw new Error(toFriendlyError(err));
  }
}

