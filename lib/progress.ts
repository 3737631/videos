/**
 * PROGRESO REAL Y MONÓTONO V3 — fases completas del pipeline:
 *   Preparando proyecto → Analizando guion → Generando voz → Generando música
 *   → Creando subtítulos → Mezclando audio → Renderizando vídeo
 *   → Verificando exportación → Exportando → Listo
 * El % NUNCA retrocede ni se congela: cada banda avanza con trabajo real.
 */

export type StageName =
  | "PREPARING"
  | "ANALYZING_SCRIPT"
  | "GENERATING_VOICE"
  | "GENERATING_MUSIC"
  | "CREATING_SUBTITLES"
  | "MIXING_AUDIO"
  | "RENDERING"
  | "VERIFYING"
  | "EXPORTING"
  | "DONE"
  | "ERROR";

/** Banda [inicio, fin] del % global para cada fase */
export const STAGE_BANDS: Record<Exclude<StageName, "ERROR">, [number, number]> = {
  PREPARING: [1, 6],
  ANALYZING_SCRIPT: [6, 12],
  GENERATING_VOICE: [12, 42],
  GENERATING_MUSIC: [42, 52],
  CREATING_SUBTITLES: [52, 58],
  MIXING_AUDIO: [58, 70],
  RENDERING: [70, 90],
  VERIFYING: [90, 96],
  EXPORTING: [96, 100],
  DONE: [100, 100],
};

export const STAGE_LABELS: Record<StageName, string> = {
  PREPARING: "Preparando proyecto…",
  ANALYZING_SCRIPT: "Analizando guion…",
  GENERATING_VOICE: "Generando voz…",
  GENERATING_MUSIC: "Generando música…",
  CREATING_SUBTITLES: "Creando subtítulos…",
  MIXING_AUDIO: "Mezclando audio…",
  RENDERING: "Renderizando vídeo…",
  VERIFYING: "Verificando exportación…",
  EXPORTING: "Exportando…",
  DONE: "¡Tu vídeo está listo!",
  ERROR: "Algo salió mal",
};

export interface ProgressTracker {
  set(stage: Exclude<StageName, "ERROR" | "DONE">, pctInBand?: number): void;
  done(): void;
  fail(): void;
  current(): number;
}

export function createProgressTracker(
  report: (stage: StageName, humanLabel: string, pct: number) => void
): ProgressTracker {
  let max = -1;
  const apply = (stage: StageName, pct: number) => {
    // MONOTONÍA: nunca menor que lo ya mostrado
    const clamped = Math.max(max, Math.max(0, Math.min(100, Math.round(pct))));
    max = clamped;
    report(stage, STAGE_LABELS[stage], clamped);
  };
  return {
    set(stage, pctInBand = 0) {
      const [a, b] = STAGE_BANDS[stage];
      const p = pctInBand <= 0 ? a : a + ((b - a) * Math.min(100, Math.max(0, pctInBand))) / 100;
      apply(stage, p);
    },
    done() {
      apply("DONE", 100);
    },
    fail() {
      report("ERROR", STAGE_LABELS.ERROR, max >= 0 ? max : 0);
    },
    current() {
      return max;
    },
  };
}
