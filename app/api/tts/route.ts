import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 400;

const LANG_MAP: Record<string, string> = {
  es: "es-ES",
  en: "en-US",
  pt: "pt-BR",
  fr: "fr-FR",
};

const VOICE_MAP: Record<string, string> = {
  es: "Mia",
  en: "Brian",
  pt: "Vitoria",
  fr: "Celine",
};

function isValidAudioResponse(response: Response, buffer: ArrayBuffer): boolean {
  if (!response.ok) return false;
  if (!buffer || buffer.byteLength < 500) return false;

  const contentType = response.headers.get("content-type") || "";

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/json") ||
    contentType.includes("text/plain")
  ) {
    return false;
  }

  return true;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function tryGoogleTTS(
  text: string,
  lang: string
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const targetLang = LANG_MAP[lang] || LANG_MAP.es;
  const clean = text.slice(0, MAX_TEXT_LENGTH);

  const url =
    `https://translate.googleapis.com/translate_tts` +
    `?ie=UTF-8` +
    `&tl=${encodeURIComponent(targetLang)}` +
    `&client=tw-ob` +
    `&q=${encodeURIComponent(clean)}`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Referer: "https://translate.google.com/",
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
        },
      },
      10000
    );

    const buffer = await response.arrayBuffer();

    if (isValidAudioResponse(response, buffer)) {
      return {
        buffer,
        contentType: response.headers.get("content-type") || "audio/mpeg",
      };
    }
  } catch {
    // ignore and fallback
  }

  return null;
}

async function tryStreamElementsTTS(
  text: string,
  lang: string
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const voice = VOICE_MAP[lang] || VOICE_MAP.es;
  const clean = text.slice(0, MAX_TEXT_LENGTH);

  const url =
    `https://api.streamelements.com/kappa/v2/speech` +
    `?voice=${encodeURIComponent(voice)}` +
    `&text=${encodeURIComponent(clean)}`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
        },
      },
      10000
    );

    const buffer = await response.arrayBuffer();

    if (isValidAudioResponse(response, buffer)) {
      return {
        buffer,
        contentType: response.headers.get("content-type") || "audio/mpeg",
      };
    }
  } catch {
    // fallback
  }

  return null;
}

async function tryEnvProviderTTS(
  text: string
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const apiKey = process.env.TTS_API_KEY;
  const apiUrl = process.env.TTS_API_URL;

  if (!apiKey || !apiUrl) return null;

  const clean = text.slice(0, MAX_TEXT_LENGTH);

  try {
    const response = await fetchWithTimeout(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
        },
        body: JSON.stringify({ text: clean }),
      },
      10000
    );

    const buffer = await response.arrayBuffer();

    if (isValidAudioResponse(response, buffer)) {
      return {
        buffer,
        contentType: response.headers.get("content-type") || "audio/mpeg",
      };
    }
  } catch {
    // fallback
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Solicitud inválida." },
        { status: 400 }
      );
    }

    const rawText = typeof body.text === "string" ? body.text : "";
    const langRaw =
      typeof body.lang === "string" ? body.lang.toLowerCase() : "es";

    const text = rawText.trim().slice(0, MAX_TEXT_LENGTH);

    if (!text) {
      return NextResponse.json(
        { error: "El texto es obligatorio." },
        { status: 400 }
      );
    }

    if (!LANG_MAP[langRaw]) {
      return NextResponse.json(
        { error: "Idioma no soportado. Usa es, en, pt o fr." },
        { status: 400 }
      );
    }

    const sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    // Prioridad: 1. ENV provider si existe, 2. Google, 3. StreamElements
    const envResult = await tryEnvProviderTTS(sanitized);
    if (envResult) {
      return new NextResponse(envResult.buffer, {
        status: 200,
        headers: {
          "Content-Type": envResult.contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    const googleResult = await tryGoogleTTS(sanitized, langRaw);
    if (googleResult) {
      return new NextResponse(googleResult.buffer, {
        status: 200,
        headers: {
          "Content-Type": googleResult.contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    const seResult = await tryStreamElementsTTS(sanitized, langRaw);
    if (seResult) {
      return new NextResponse(seResult.buffer, {
        status: 200,
        headers: {
          "Content-Type": seResult.contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(
      {
        error:
          "No se pudo generar la voz en este momento. Comprueba tu conexión y vuelve a intentarlo.",
      },
      { status: 502 }
    );
  } catch (error) {
    console.error("TTS error:", error);

    return NextResponse.json(
      {
        error: "Error interno al generar la voz.",
      },
      { status: 500 }
    );
  }
}
