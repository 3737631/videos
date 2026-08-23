"use client";

import { useMemo, useState } from "react";
import { countWords } from "@/lib/script/generator";
import { WORDS_PER_SEC, normalizeGenLang } from "@/lib/script/generator";
import { getStyle } from "@/lib/script/styles";

const SAMPLE_PHRASES: Record<string, string> = {
  es: "Este producto está cambiando la forma de hacer esto.",
};

export function samplePhrase(lang: string): string {
  return SAMPLE_PHRASES[lang.slice(0, 2)] ?? SAMPLE_PHRASES.es;
}

/** Duración estimada del texto a la velocidad efectiva del estilo */
export function estimateSeconds(
  text: string,
  lang: string,
  styleMul: number
): number {
  const words = countWords(text);
  const wps = WORDS_PER_SEC[normalizeGenLang(lang)];
  return words / Math.max(0.5, wps * Math.min(1.5, Math.max(0.7, styleMul)));
}

interface Props {
  script: string;
  onChange: (t: string) => void;
  targetSec: number | null;
  lang: string;
  styleId: string;
}

/**
 * GUION — mostrado al usuario con panel desplegable de edición.
 * Recalcula palabras y duración estimada en vivo contra el objetivo.
 */
export function ScriptPanel({ script, onChange, targetSec, lang, styleId }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(script);
  const style = getStyle(styleId);
  const words = useMemo(() => countWords(open ? draft : script), [draft, script, open]);
  const est = useMemo(
    () => estimateSeconds(open ? draft : script, lang, style.speedMul),
    [draft, script, open, lang, style.speedMul]
  );
  const diff = targetSec != null ? est - targetSec : 0;
  const tooLong = targetSec != null && diff > Math.max(0.6, targetSec * 0.12);
  const tooShort = targetSec != null && diff < -Math.max(0.6, targetSec * 0.12);

  return (
    <section className="cc-card p-5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-gray-200">Guion</label>
          <button
            onClick={() => {
              if (!open) setDraft(script);
              setOpen((x) => !x);
            }}
            className="text-xs font-medium text-violet-300 hover:text-violet-200"
          >
            {open ? "Cerrar editor" : "Editar guion"}
          </button>
      </div>

      {!open ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
          {script || "—"}
        </p>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={7}
            className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/10"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>
              <b className="text-gray-300">{words}</b> palabras
            </span>
            <span>
              Duración estimada:{" "}
              <b className="text-gray-300">{est.toFixed(1)} s</b>
              {targetSec != null && (
                <> · objetivo {targetSec.toFixed(1)} s</>
              )}
            </span>
          </div>

          {tooLong && (
            <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              El guion es demasiado largo para el vídeo.
            </div>
          )}
          {tooShort && (
            <div className="mt-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              El guion es demasiado corto: sobrará vídeo sin voz.
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onChange(draft)}
              className="cc-btn-primary rounded-xl px-4 py-2 text-xs font-bold text-white"
            >
              Guardar cambios
            </button>
            <button
              onClick={() => setDraft(script)}
              className="rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/5"
            >
              Descartar cambios
            </button>
          </div>
        </>
      )}

      {!open && (
        <div className="mt-2 text-[11px] text-gray-500">
          {words} palabras · ~{est.toFixed(1)} s
          {targetSec != null && <> de {targetSec.toFixed(1)} s</>}
        </div>
      )}
    </section>
  );
}
