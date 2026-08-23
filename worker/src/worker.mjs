/**
 * SERVIDOR DE VOZ de ClipCraft (Cloudflare Worker).
 *
 * El navegador NUNCA ve claves: este worker guarda ELEVENLABS_API_KEY y
 * GROQ_API_KEY como secretos y expone solo endpoints propios.
 *
 *   GET  /health            → { ok: true }
 *   POST /tts               → audio/mpeg  { text, voiceId, locale }
 *   POST /llm               → { content } { messages, model, maxTokens }
 *   POST /stt (multipart)   → verbose_json con palabras + idioma del form
 *
 * Despliegue: ver wrangler.toml (comentarios) o README-DEPLOY.md
 */

const ELEVEN_TTS = "https://api.elevenlabs.io/v1/text-to-speech";
const GROQ_LLM = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_STT = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "eleven_multilingual_v2";

const MAX_TEXT_CHARS = 1500;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function cors(req) {
  const allowed = (globalThis.ALLOWED_ORIGIN || "").trim();
  const origin = req.headers.get("Origin") || "";
  const allowAll = !allowed;
  return {
    "Access-Control-Allow-Origin": allowAll ? "*" : origin === allowed ? allowed : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status = 200, req = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...(req ? cors(req) : {}) },
  });
}

function humanError(status, msg) {
  return { error: msg };
}

export default {
  async fetch(request) {
    const req = request;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);

    try {
      // ---------- Salud ----------
      if (url.pathname === "/health") {
        const env = globalThis;
        return json(
          {
            ok: true,
            tts: Boolean(env.ELEVENLABS_API_KEY),
            llm: Boolean(env.GROQ_API_KEY),
          },
          200,
          req
        );
      }

      // ---------- TTS ----------
      if (url.pathname === "/tts" && req.method === "POST") {
        const key = globalThis.ELEVENLABS_API_KEY;
        if (!key) return json(humanError(503, "El servidor no tiene configurada la clave de voz"), 503, req);
        let body;
        try {
          body = await req.json();
        } catch {
          return json(humanError(400, "Cuerpo inválido"), 400, req);
        }
        const text = String(body.text || "").trim();
        const voiceId = /^[a-zA-Z0-9]{10,40}$/.test(String(body.voiceId || ""))
          ? String(body.voiceId)
          : "";
        const locale = String(body.locale || "").slice(0, 12);
        if (!text) return json(humanError(400, "Falta el texto"), 400, req);
        if (text.length > MAX_TEXT_CHARS) return json(humanError(413, "Texto demasiado largo"), 413, req);
        if (!voiceId) return json(humanError(400, "Voz inválida"), 400, req);
        void locale; // multilingual_v2 detecta el idioma del texto

        const upstream = await fetch(`${ELEVEN_TTS}/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: DEFAULT_MODEL,
            voice_settings: { stability: 0.45, similarity_boost: 0.75 },
          }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          const status = upstream.status === 401 || upstream.status === 404 ? 502 : upstream.status === 429 ? 429 : 502;
          return json(humanError(status, `Proveedor de voz no disponible (${upstream.status}) ${detail.slice(0, 120)}`), status, req);
        }
        const audio = await upstream.arrayBuffer();
        if (audio.byteLength < 800) {
          return json(humanError(502, "El proveedor devolvió un audio vacío"), 502, req);
        }
        return new Response(audio, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400",
            ...cors(req),
          },
        });
      }

      // ---------- LLM (Groq) ----------
      if (url.pathname === "/llm" && req.method === "POST") {
        const key = globalThis.GROQ_API_KEY;
        if (!key) return json(humanError(503, "El servidor no tiene configurada la clave de texto IA"), 503, req);
        let body;
        try {
          body = await req.json();
        } catch {
          return json(humanError(400, "Cuerpo inválido"), 400, req);
        }
        const messages = Array.isArray(body.messages) ? body.messages.slice(0, 20) : null;
        const model = /^[\w.\-\/]{1,64}$/.test(String(body.model || "")) ? String(body.model) : "llama-3.3-70b-versatile";
        const maxTokens = Math.min(2000, Math.max(64, Number(body.maxTokens) || 800));
        if (!messages) return json(humanError(400, "Mensajes inválidos"), 400, req);

        const upstream = await fetch(GROQ_LLM, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.8 }),
        });
        if (!upstream.ok) {
          const s = upstream.status;
          return json(humanError(s === 429 ? 429 : 502, `Servicio de texto no disponible (${s})`), s === 429 ? 429 : 502, req);
        }
        const data = await upstream.json();
        const content = data?.choices?.[0]?.message?.content || "";
        return json({ content }, 200, req);
      }

      // ---------- STT (Groq Whisper) ----------
      if (url.pathname === "/stt" && req.method === "POST") {
        const key = globalThis.GROQ_API_KEY;
        if (!key) return json(humanError(503, "El servidor no tiene configurada la clave de transcripción"), 503, req);
        const form = await req.formData();
        const file = form.get("file");
        const language = String(form.get("language") || "es").slice(0, 8);
        if (!(file instanceof File)) return json(humanError(400, "Falta el audio"), 400, req);
        if (file.size > MAX_AUDIO_BYTES) return json(humanError(413, "Audio demasiado grande"), 413, req);

        const up = new FormData();
        up.append("file", file, file.name || "voice.webm");
        up.append("model", "whisper-large-v3-turbo");
        up.append("response_format", "verbose_json");
        up.append("timestamp_granularities[]", "word");
        up.append("language", language);

        const upstream = await fetch(GROQ_STT, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: up,
        });
        if (!upstream.ok) {
          const s = upstream.status;
          return json(humanError(s === 429 ? 429 : 502, `Transcripción no disponible (${s})`), s === 429 ? 429 : 502, req);
        }
        return new Response(upstream.body, {
          status: 200,
          headers: { "Content-Type": "application/json", ...cors(req) },
        });
      }

      return json(humanError(404, "Ruta desconocida"), 404, req);
    } catch (e) {
      console.error("[worker]", e);
      return json(humanError(500, "Error interno del servidor de voz"), 500, req);
    }
  },
};
