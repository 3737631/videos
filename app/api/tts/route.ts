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

function isValidAudioResponse(response: Response, buffer: ArrayBuffer) {
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
) {
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Solicitud inválida." },
        { status: 400 }
      );
    }

    const text =
      typeof body.text === "string" ? body.text.trim() : "";

    const lang =
      typeof body.lang === "string" ? body.lang.toLowerCase() : "es";

    if (!text) {
      return NextResponse.json(
        { error: "El texto es obligatorio." },
        { status: 400 }
      );
    }

    const cleanText = text.slice(0, MAX_TEXT_LENGTH);
    const targetLang = LANG_MAP[lang] || LANG_MAP.es;
    const voice = VOICE_MAP[lang] || VOICE_MAP.es;

    // PROVEEDOR 1 - Google Translate TTS
    try {
      const googleUrl =
        `https://translate.googleapis.com/translate_tts` +
        `?ie=UTF-8` +
        `&tl=${encodeURIComponent(targetLang)}` +
        `&client=tw-ob` +
        `&q=${encodeURIComponent(cleanText)}`;

      const response = await fetchWithTimeout(
        googleUrl,
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
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }
    } catch {
      // Intentar proveedor secundario.
    }

    // PROVEEDOR 2 - StreamElements
    try {
      const seUrl =
        `https://api.streamelements.com/kappa/v2/speech` +
        `?voice=${encodeURIComponent(voice)}` +
        `&text=${encodeURIComponent(cleanText)}`;

      const response = await fetchWithTimeout(
        seUrl,
        {
          headers: {
            Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
          },
        },
        10000
      );

      const buffer = await response.arrayBuffer();

      if (isValidAudioResponse(response, buffer)) {
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }
    } catch {
      // Los dos proveedores han fallado.
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
