import type { AppSettings, HookOption, ScriptSegment, SubtitleCue, WordTimestamp } from "@/types";
import { serviceStatus } from "@/lib/storage";

export function structuredError(code: string, message: string, retryable = false) {
  return { success: false as const, error: { code, message, retryable } };
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export async function chat(
  settings: AppSettings,
  messages: { role: "system" | "user"; content: string }[],
  maxTokens = 800
): Promise<string> {
  const status = serviceStatus(settings, "llm");
  if (!status.configured) {
    throw new Error(
      `Servicio LLM no configurado. Añade tu clave en Configuración (llmApiKey).`
    );
  }

  const baseUrl = settings.llmProvider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = settings.llmModel || (settings.llmProvider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini");

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { ...headers(), Authorization: `Bearer ${settings.llmApiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.8 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new Error(
      retryable
        ? `El proveedor LLM está sobrecargado (${res.status}). Reintenta en unos segundos.`
        : `Error del proveedor LLM (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("El proveedor LLM no devolvió contenido");
  return content.trim();
}

export async function generateHooks(
  settings: AppSettings,
  analysisText: string
): Promise<HookOption[]> {
  const system = `Eres un experto en vídeo vertical para TikTok, Reels y Shorts. Genera hooks (frases de enganche) para un vídeo. Cada hook debe ser corto (< 12 palabras), crear curiosidad o prometer un beneficio, en español, y sonar como una persona real. NUNCA inventes características, precios o resultados que no aparezcan en el análisis. Si el análisis no da datos del producto, haz hooks genéricos de curiosidad.`;

  const user = `Análisis del vídeo:\n${analysisText}\n\nGenera exactamente 5 hooks. Devuelve SOLO JSON: [{"text":"...","score":85},...] con score 0-100 de fuerza estimada.`;

  const raw = await chat(settings, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], 500);

  const parsed = parseJsonArray(raw);
  return parsed.map((h, i) => ({
    id: `hook-${i}-${Date.now()}`,
    text: String(h.text || "").trim(),
    score: Math.max(0, Math.min(100, Number(h.score) || 50)),
  })).filter((h) => h.text.length > 3);
}

export async function generateScript(
  settings: AppSettings,
  analysisText: string,
  hooks: HookOption[],
  selectedHook: string,
  style: string,
  goal: string
): Promise<ScriptSegment[]> {
  const system = `Eres un guionista de vídeo vertical viral. Escribe guiones cortos para ser narrados por una persona real en TikTok/Reels/Shorts. REGLAS:
- Estructura: HOOK (1 frase), DESARROLLO (1-2 frases), BENEFICIO (1 frase), PRUEBA (1 frase basada solo en lo visible), CTA (1 frase).
- Máximo 60 palabras en total.
- Lenguaje natural, conversacional, específico. Nada robótico ni genérico.
- NUNCA inventes características, precios, marcas, resultados ni testimonios. Usa únicamente la información del análisis del vídeo. Si algo no se sabe, no se afirma.
- Estilo del vídeo: ${style}. Objetivo: ${goal}.`;

  const user = `Análisis del vídeo:\n${analysisText}\n\nHook elegido: "${selectedHook}"\nOtros hooks candidatos:\n${hooks.map((h) => `- ${h.text}`).join("\n")}\n\nGenera el guion. Devuelve SOLO JSON: [{"kind":"hook","text":"..."},{"kind":"desarrollo","text":"..."},{"kind":"beneficio","text":"..."},{"kind":"prueba","text":"..."},{"kind":"cta","text":"..."}]`;

  const raw = await chat(settings, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], 700);

  const parsed = parseJsonArray(raw);
  const validKinds = new Set(["hook", "desarrollo", "beneficio", "prueba", "cta"]);
  return parsed
    .filter((s) => validKinds.has(String(s.kind)) && String(s.text || "").trim().length > 2)
    .map((s) => ({ kind: s.kind as ScriptSegment["kind"], text: String(s.text).trim() }));
}

export async function generateCta(settings: AppSettings, goal: string): Promise<string[]> {
  const user = `Genera 4 frases CTA para vídeo vertical (español, cortas, naturales, para objetivo: ${goal}). Devuelve SOLO JSON: ["...","...","...","..."]`;
  const raw = await chat(settings, [
    { role: "system", content: "Eres un experto en CTA para vídeo social. Frases cortas, directas, nada de clickbait falso." },
    { role: "user", content: user },
  ], 300);
  return parseJsonArray(raw).map((c) => String(c).trim()).filter((c) => c.length > 2).slice(0, 4);
}

export async function generateProductScript(
  settings: AppSettings,
  productInfo: string
): Promise<ScriptSegment[]> {
  const system = `Eres un creador de vídeos virales de productos para TikTok. Escribe un guion EN INGLÉS para narrar con voz. REGLAS:
- Estructura: HOOK (1 frase potente), DESARROLLO (1-2 frases del producto), BENEFICIO (1 frase), PRUEBA (1 frase), CTA (1 frase tipo "link in bio").
- Máximo 60 palabras en total. Frases cortas y punchy.
- Usa SOLO los datos del producto (nombre, función, precio si aparece). No inventes nada más.`;

  const user = `Datos del producto:\n${productInfo.slice(0, 1200)}\n\nDevuelve SOLO JSON: [{"kind":"hook","text":"..."},{"kind":"desarrollo","text":"..."},{"kind":"beneficio","text":"..."},{"kind":"prueba","text":"..."},{"kind":"cta","text":"..."}]`;

  const raw = await chat(settings, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], 700);

  const parsed = parseJsonArray(raw);
  const validKinds = new Set(["hook", "desarrollo", "beneficio", "prueba", "cta"]);
  return parsed
    .filter((s) => validKinds.has(String(s.kind)) && String(s.text || "").trim().length > 2)
    .map((s) => ({ kind: s.kind as ScriptSegment["kind"], text: String(s.text).trim() }));
}

export async function transcribeWithTimestamps(
  settings: AppSettings,
  audioBlob: Blob,
  onProgress?: (pct: number) => void
): Promise<SubtitleCue[]> {
  const status = serviceStatus(settings, "stt");
  if (!status.configured) {
    throw new Error("Servicio de transcripción no configurado. Añade tu clave en Configuración (sttApiKey).");
  }

  const baseUrl = settings.sttProvider === "groq"
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";
  const model = settings.sttProvider === "groq" ? "whisper-large-v3" : "whisper-1";

  const form = new FormData();
  form.append("file", audioBlob, "voice.mp3");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("language", "es");

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.sttApiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new Error(
      retryable
        ? `El servicio de transcripción está sobrecargado (${res.status}). Reintenta.`
        : `Error de transcripción (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const data = await res.json();
  onProgress?.(50);

  const words: WordTimestamp[] = (data.words || []).map(
    (w: { word?: string; start?: number; end?: number }) => ({
      word: String(w.word || "").trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    })
  ).filter((w: { word: string; start: number; end: number }) => w.word);

  if (!words.length) {
    const segments = data.segments || [];
    for (const seg of segments) {
      const text = String(seg.text || "").trim();
      if (!text) continue;
      const start = Number(seg.start) || 0;
      const end = Number(seg.end) || start + 1;
      words.push({ word: text, start, end });
    }
  }

  onProgress?.(100);
  return buildCuesFromWords(words);
}

function buildCuesFromWords(words: WordTimestamp[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let current: WordTimestamp[] = [];
  let currentText = "";
  let cueStart = 0;
  const MAX_CHARS = 42;

  for (const w of words) {
    const would = currentText ? `${currentText} ${w.word}` : w.word;
    if (!current.length) cueStart = w.start;
    if (would.length > MAX_CHARS) {
      if (current.length) {
        cues.push({
          start: cueStart,
          end: current[current.length - 1].end,
          text: currentText,
          words: current,
        });
      }
      current = [w];
      currentText = w.word;
      cueStart = w.start;
    } else {
      current.push(w);
      currentText = would;
    }
  }
  if (current.length) {
    cues.push({
      start: cueStart,
      end: current[current.length - 1].end,
      text: currentText,
      words: current,
    });
  }
  return cues;
}

function parseJsonArray(raw: string): any[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // sigue
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}