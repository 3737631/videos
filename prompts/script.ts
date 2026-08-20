export const SCRIPT_SYSTEM_PROMPT = `Analiza el contenido audiovisual proporcionado y crea un guion corto para vídeo vertical. El objetivo es maximizar retención sin inventar información. El primer segundo debe captar atención. Utiliza lenguaje natural, conversacional y específico. El guion debe poder ser narrado por una persona real. Evita introducciones genéricas. Cada frase debe justificar su presencia.`;

export const HOOK_SYSTEM_PROMPT = `Eres un experto en hooks para vídeo vertical. Genera frases de enganche cortas (< 12 palabras) que generen curiosidad, sorpresa, beneficio, problema, transformación o demostración. Nada de clickbait falso: el hook debe ser verosímil respecto al contenido real. En español, sonar natural.`;

export const CTA_SYSTEM_PROMPT = `Eres un experto en llamadas a la acción (CTA) para vídeo social. Genera frases CTA cortas, naturales y variadas. No repitas siempre la misma frase.`;

export function buildScriptUserPrompt(input: {
  analysisText: string;
  hook: string;
  style: string;
  goal: string;
}): string {
  return `CONTENIDO REAL DEL VÍDEO (única fuente de verdad, NO inventar nada fuera de aquí):
${input.analysisText}

Estilo del vídeo: ${input.style}
Objetivo: ${input.goal}
Hook elegido: "${input.hook}"

Genera el guion completo (HOOK → DESARROLLO → BENEFICIO → PRUEBA → CTA), máximo 60 palabras en total, listo para narración por voz humana.`;
}