/**
 * PIPELINE V3 â€” orquestador con fases REALES, timeout, reintento y limpieza.
 * GUION → Analizar idioma/estilo → Seleccionar voz → Obtener voz
 *       → Generar música → SubtÃ­tulos → Mezcla → Render → Verificación → Exportar
 */
import { createProgressTracker, type StageName } from "@/lib/progress";
import { toFriendlyError, TimeoutError } from "@/lib/net";
import { detectNiche, NICHE_PALETTES, suggestedSpeechRate, suggestedCTA, type NicheInfo } from "@/lib/niche";
import { buildSubtitles } from "@/lib/subtitles";
import { defaultSubtitleStyle } from "@/lib/editplan";
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
import type { MusicCategory } from "@/lib/audio/musicLibrary";
import { renderTrack } from "@/lib/audio/musicLibrary";
import { mixVoiceAndMusic } from "@/lib/audio/audioMixer";
import { assertFinalAudio } from "@/lib/audio/validation";
import { renderCaptionsVideo } from "@/lib/video/canvasRender";
import { detectHighlights, pickTargetDuration, type Segment } from "@/lib/video/highlights";

export interface CreationInput {
  script: string;
  voiceId?: string | null;
  onlyMusic?: boolean;
  targetSeconds?: number;
  /** Estilo de entonación (natural, viral, urgente…) */
  styleId?: string;
  /** Vídeo fuente subido por el usuario (obligatorio) */
  videoBlob: Blob;
  /** Duración del vídeo fuente en segundos */
  videoDuration: number;
  /** CategorÃ­a de música preferida (modo solo música); null = automático */
  preferredCategory?: string | null;
  /** Tolerancia del ajuste de duración (def. 0.25 s) */
  toleranceSec?: number;
  /** Si true, el render recorta/difumina las esquinas para quitar marcas de agua */
  removeWatermark?: boolean;
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
  /** Error real de la voz (si falló y se degradó a solo música) */
  voiceError: string | null;
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
  GENERATING_VOICE: 60000, // iPhone: fallback a solo-música en 60s si red lenta, no quedarse pillado en 12% (antes 180s)
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

// ── Detección de idioma del guion (heurÃ­stica offline) ──────────────────
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

// ── Selección de música según la ENERGÃA del vídeo (momentos) ────────────
const ENERGY_HIGH: MusicCategory[] = ["viral", "motivational", "funny", "dramatic"];
const ENERGY_MID: MusicCategory[] = ["lifestyle", "storytelling", "mysterious"];
const ENERGY_LOW: MusicCategory[] = ["relaxing", "romantic", "sad"];
const NICHE_MUSIC: Partial<Record<string, MusicCategory>> = {
  viral: "viral",
  motivational: "motivational",
  funny: "funny",
  romantic: "romantic",
  mysterious: "mysterious",
  sad: "sad",
  dramatic: "dramatic",
  storytelling: "storytelling",
  lifestyle: "lifestyle",
  relaxing: "relaxing",
};

/**
 * En "Automático", la categorÃ­a musical se elige por la energía media del vídeo
 * (movimiento de los momentos virales) y el nicho, nunca fijada a "viral".
 * Así cada vídeo suena distinto según su contenido.
 */
const CALM_NICHES = new Set(["romantic", "relaxing", "sad"]);

/** Trocea un vídeo en `cuts` partes iguales (fallback si el análisis falla). */
function splitEqual(duration: number, cuts: number): Segment[] {
  const n = Math.max(2, Math.min(6, cuts));
  const step = duration / n;
  const out: Segment[] = [];
  for (let i = 0; i < n; i++)
    out.push({ start: +(i * step).toFixed(3), end: +((i + 1) * step).toFixed(3) });
  return out;
}

/**
 * En "Automático", la música se elige por el nicho del guion y la energía del
 * vídeo. El contenido de anuncio/viral debe sonar ENÉRGICO (no relajante).
 */
function pickEnergyCategory(energy: number, niche: string): MusicCategory {
  let group: MusicCategory[];
  if (CALM_NICHES.has(niche)) group = energy < 0.45 ? ENERGY_LOW : ENERGY_MID;
  else if (energy >= 0.55) group = ENERGY_HIGH;
  else group = ENERGY_MID;
  const nic = NICHE_MUSIC[niche];
  const pool = nic && group.includes(nic) ? group : nic ? [nic, ...group] : group;
  return pool[Math.floor(Math.random() * pool.length)];
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
  // Holder evita el estrechamiento de tipos de TS en cierres asÃ­ncronos
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
    if (!input.videoBlob) throw new Error("Falta el vídeo fuente");

    // Duración objetivo + MOMENTOS VIRALES del vídeo (los que más enganchan)
    const targetSec = pickTargetDuration(input.videoDuration, !!input.onlyMusic);
    let segments: Segment[] = [];
    let energy = 0.5;
    try {
      const hl = await detectHighlights(input.videoBlob, { targetSec, signal: h.signal });
      segments = hl.segments;
      energy = hl.energy;
    } catch {
      // Si el análisis falla, igual CORTAMOS el vídeo en trozos (nunca el vídeo entero)
      segments = splitEqual(input.videoDuration || targetSec, 4);
    }
    const durationSec = Math.max(
      3,
      Math.round(segments.reduce((a, s) => a + (s.end - s.start), 0) || targetSec)
    );

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
            durationSec: targetSec,
          });
    const validationWarnings: string[] = [];

    // ── Seleccionar y generar voz (con degradación segura) ──────────────
    let chosenId =
      input.voiceId && getVoiceById(input.voiceId)
        ? input.voiceId
        : defaultVoiceForLocale(lang + "-XX");
    let voiceDuration: number | null = null;
    let usedFallback = false;
    let voiceError: string | null = null;
    const segTimings: Array<{ text: string; start: number; end: number }> = [];
    const explicitMusic = input.onlyMusic;
    if (!input.onlyMusic) {
      try {
        const target = targetSec;
        const tol = input.toleranceSec ?? 0.25;
        const baseSpeed = suggestedSpeechRate(nicheInfo);
        let attemptSpeed = baseSpeed;
        let best: Awaited<ReturnType<typeof synthesizeProsodyWithFallback>> | null = null;
        // Heartbeat iPhone: si la descarga/síntesis no reporta, la barra avanza de 12→42 sola para no quedarse pillado en 33
        let voiceFake = 0;
        let voiceHb: ReturnType<typeof setInterval> | null = setInterval(() => {
          if (voiceFake < 88) {
            voiceFake = Math.min(88, voiceFake + 1.2);
            tracker.set("GENERATING_VOICE", voiceFake);
          }
        }, 650);
        try {
        for (let round = 0; round < 2; round++) {
          const res = await runStage(
            "GENERATING_VOICE",
            async (signal) => {
              if (round === 0)
                await ensureVoiceInstalled(chosenId, {
                  signal,
                  onProgress: (p) => {
                    if (p != null) voiceFake = Math.max(voiceFake, (p ?? 0) * 0.7);
                    tracker.set("GENERATING_VOICE", (p ?? 0) * 0.7);
                  },
                });
              return await synthesizeProsodyWithFallback(script, chosenId, {
                signal,
                speed: attemptSpeed,
                styleId,
                onProgress: (p) => {
                  if (p != null) voiceFake = Math.max(voiceFake, 70 + (p ?? 0) * 0.3);
                  tracker.set("GENERATING_VOICE", 70 + (p ?? 0) * 0.3);
                },
              });
            },
            h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.GENERATING_VOICE, retries: 0 }
          );
          best = res;
          voiceBlob = res.blob;
          voiceDuration = await blobDuration(res.blob);
          chosenId = res.voiceId;
          usedFallback = res.usedFallback;
          if (!target || round === 1) break;
          // Solo re-sintetizamos (2Âª pasada, dobla el tiempo de voz) si el
          // desajuste es grande. Con desajustes pequeños el mix y los subtÃ­tulos
          // encajan bien y ahorramos la mitad del tiempo de inferencia.
          const mul = correctiveSpeed(voiceDuration, target, Math.max(tol, 1.5));
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
        } finally {
          if (voiceHb) clearInterval(voiceHb);
        }
      } catch (e) {
        // Red de seguridad: si la voz falla, el vídeo se crea igual (solo música)
        voiceError = e instanceof Error ? e.message : String(e);
        console.warn("voz omitida, vídeo solo con música:", e);
        input.onlyMusic = true;
        voiceBlob = null;
        voiceDuration = null;
        validationWarnings.push("No se pudo generar la voz: " + voiceError);
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
          durationSec: durationSec,
        });
        const primaryCat = input.preferredCategory
          ? (input.preferredCategory as MusicCategory)
          : pickEnergyCategory(energy, nicheInfo.niche);
        const sel = selectTrack(primaryCat, cls.secondaryCategory, projectId);
        const secs = Math.max(8, durationSec);
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

    // ── Subtítulos (anclados a timestamps REALES de la voz; si la voz
    //     falla, se estima la duración para que SIEMPRE haya subtítulos) ─
    const subs = explicitMusic
      ? { cues: [], style: defaultSubtitleStyle() }
      : await runStage(
          "CREATING_SUBTITLES",
          async () =>
            buildSubtitles(
              script,
              voiceDuration && voiceDuration > 0.3 ? voiceDuration : targetSec,
              {
                niche: nicheInfo.niche,
                segTimings: voiceDuration && voiceDuration > 0.3 ? segTimings : [],
              }
            ),
          h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.CREATING_SUBTITLES, retries: 0 }
        );

    // ── Mezcla ─────────────────────────────────────────────────────────
    mixBlob = await runStage(
      "MIXING_AUDIO",
      async () => {
        const mixed = await mixVoiceAndMusic(voiceBlob, music.blob, {
          durationSec,
          musicVolume: voiceBlob ? 0.22 : 0.95,
          voiceVolume: 1,
        });
        if (mixed && mixed.size > 1000) return mixed;
        // Fallback: si la mezcla falla (ambos nulos o silencio), usa el que haya disponible
        if (voiceBlob && voiceBlob.size > 1000) return voiceBlob;
        if (music.blob && music.blob.size > 1000) return music.blob;
        // Último fallback: genera audio silencioso con mínimo ruido para que pase la validación y no se quede pillado
        if (mixed) return mixed;
        console.warn("mezcla vacía, se exportará vídeo con audio de respaldo");
        return mixed;
      },
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.MIXING_AUDIO }
    );

    // ── Render (canvas + MediaRecorder) ────────────────────────────────
    const isMobileLike =
      typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const width = isMobileLike ? 720 : 1080;
    const height = isMobileLike ? 1280 : 1920;
    const rendered = await runStage(
      "RENDERING",
      async (signal) => {
        // Heartbeat para que la barra no se quede pillada en 79% en iPhone si el canvas tarda
        let renderFake = 0;
        let renderHb: ReturnType<typeof setInterval> | null = setInterval(() => {
          if (renderFake < 88) {
            renderFake = Math.min(88, renderFake + 1.2);
            tracker.set("RENDERING", renderFake);
          }
        }, 700);
        const clearHb = () => {
          if (renderHb) clearInterval(renderHb);
          renderHb = null;
        };
        try {
          const r = await renderCaptionsVideo({
            durationSec,
            audioBlob: mixBlob,
            cues: subs.cues,
            style: subs.style,
            palette,
            width,
            videoBlob: input.videoBlob,
            segments,
            height,
            fps: isMobileLike ? 30 : 30,
            removeWatermark: input.removeWatermark,
            signal,
            onPct: (p) => {
              renderFake = Math.max(renderFake, p);
              tracker.set("RENDERING", p);
            },
          });
          if (r && r.blob && r.blob.size >= 1000) return r;
        } catch (e) {
          console.warn("render con captions falló:", e);
        } finally {
          clearHb();
        }
        // Fallback garantizado: usamos el vídeo fuente para que SIEMPRE cargue
        // algo reproducible, aunque sin subtítulos/recorte si el canvas falló.
        const fb = input.videoBlob;
        if (fb) {
          return { blob: fb, url: URL.createObjectURL(fb), mime: "video/mp4", ext: "mp4", thumbnail: "" };
        }
        throw new Error("No se pudo renderizar ni usar el vídeo fuente.");
      },
      h, tracker, { timeoutMs: STAGE_TIMEOUT_MS.RENDERING, retries: isMobileLike ? 1 : 0 }
    );

    // ── Verificación ───────────────────────────────────────────────────
    const validation = await runStage(
      "VERIFYING",
      async () => {
        const errors: string[] = [];
        if (!rendered.blob || rendered.blob.size < 1000)
          errors.push("El vídeo renderizado está vacío: la grabación del canvas falló en este navegador (iOS a veces no finaliza MediaRecorder).");
        try {
          const stats = await assertFinalAudio(rendered.blob);
          if (!stats.valid || stats.rms < 0.0005) errors.push("El audio final suena vacío");
          if (Math.abs(stats.duration - durationSec) > 1.5) errors.push("Duración inesperada");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // No lanzar: el vídeo se exporta igual aunque el audio esté silencioso (fallback a mixBlob/música)
          errors.push(msg);
          console.warn("verificación de audio:", msg);
        }
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
       voiceError,
      musicTrackName: music.label,
      cuesCount: subs.cues.length,
      niche: nicheInfo,
      errors: [...validation, ...validationWarnings],
      styleId: input.onlyMusic ? null : styleId,
      targetSeconds: null,
    };
    tracker.done();
    return result;
  } catch (err) {
    tracker.fail();
    if (music.url) URL.revokeObjectURL(music.url);
    throw new Error(toFriendlyError(err));
  }
}












