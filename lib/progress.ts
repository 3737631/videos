/**
 * PROGRESO REAL Y MONÓTONO.
 * Cada fase tiene una banda fija de porcentaje. El tracker GARANTIZA que el
 * porcentaje global nunca retrocede (clamp con máximo visto) y que cada salto
 * corresponde a una operación real completada. Sin heartbeats falsos.
 */

export type StageName =
  | "PREPARING"
  | "GENERATING_VOICE"
  | "GENERATING_MUSIC"
  | "MIXING_AUDIO"
  | "RENDERING"
  | "VERIFYING"
  | "DONE"
  | "ERROR";

/** Banda [inicio, fin] del % global para cada fase */
export const STAGE_BANDS: Record<Exclude<StageName, "ERROR">, [number, number]> = {
  PREPARING: [2, 10],
  GENERATING_VOICE: [10, 30],
  GENERATING_MUSIC: [30, 40],
  MIXING_AUDIO: [40, 55],
  RENDERING: [55, 90],
  VERIFYING: [90, 99],
  DONE: [100, 100],
};

export const STAGE_LABELS: Record<StageName, string> = {
  PREPARING: "Preparando vídeo…",
  GENERATING_VOICE: "Creando voz…",
  GENERATING_MUSIC: "Creando música…",
  MIXING_AUDIO: "Mezclando audio…",
  RENDERING: "Montando vídeo…",
  VERIFYING: "Finalizando…",
  DONE: "¡Tu vídeo está listo!",
  ERROR: "Algo salió mal",
};

export interface ProgressTracker {
  /** Marca la fase actual; `pctInBand` es 0..100 DENTRO de la banda */
  set(stage: Exclude<StageName, "ERROR" | "DONE">, pctInBand?: number): void;
  done(): void;
  fail(): void;
  /** % global máximo alcanzado (para tests) */
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
