import { NextResponse } from "next/server";

export const runtime = "nodejs";

type LanguageCode = "es" | "en" | "pt" | "fr";

const LANGUAGE_MAP: Record<LanguageCode, string> = {
  es: "es",
  en: "en",
  pt: "pt",
  fr: "fr",
};

function isValidLanguage(value: unknown): value is LanguageCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LANGUAGE_MAP, value)
  );
}

function cleanText(input: string): string {
  return input
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "audio/mpeg,audio/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function googleTranslateTTS(
  text: string,
  lang: LanguageCode
): Promise<Buffer> {
  const targetLanguage = LANGUAGE_MAP[lang];

  /*
   * Google Translate TTS funciona de forma más consistente
   * utilizando client=gtx y el código simple de idioma.
   *
   * Mantenemos el texto corto para evitar límites del endpoint.
   */
  const encodedText = encodeURIComponent(text);

  const urls = [
    `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${targetLanguage}&q=${encodedText}`,
    `https://translate.google.com/translate_tts?client=tw-ob&ie=UTF-8&tl=${targetLanguage}&q=${encodedText}`,
  ];

  let lastError = "El proveedor de voz no respondió.";

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, 12000);

      if (!response.ok) {
        lastError = `Google TTS respondió HTTP ${response.status}.`;
        continue;
      }

      const contentType = (
        response.headers.get("content-type") || ""
      ).toLowerCase();

      const arrayBuffer = await response.arrayBuffer();

      if (arrayBuffer.byteLength < 1000) {
        lastError = "Google TTS devolvió un archivo demasiado pequeño.";
        continue;
      }

      /*
       * A veces el servidor puede devolver un Content-Type poco fiable.
       * Comprobamos también que el contenido tenga apariencia de MP3.
       */
      const bytes = new Uint8Array(arrayBuffer);

      const hasId3 =
        bytes.length >= 3 &&
        bytes[0] === 0x49 &&
        bytes[1] === 0x44 &&
        bytes[2] === 0x33;

      const hasMp3Frame =
        bytes.length >= 2 &&
        bytes[0] === 0xff &&
        (bytes[1] & 0xe0) === 0xe0;

      const looksLikeAudio =
        contentType.includes("audio") || hasId3 || hasMp3Frame;

      if (!looksLikeAudio) {
        lastError =
          "Google TTS devolvió una respuesta que no parece ser un archivo de audio.";
        continue;
      }

      return Buffer.from(arrayBuffer);
    } catch (error) {
      if (error instanceof Error) {
        lastError = error.name === "AbortError"
          ? "Google TTS tardó demasiado en responder."
          : error.message;
      }
    }
  }

  throw new Error(lastError);
}

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "La petición TTS contiene JSON inválido." },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "La petición TTS no es válida." },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;

    if (typeof data.text !== "string") {
      return NextResponse.json(
        { error: "El texto es obligatorio." },
        { status: 400 }
      );
    }

    const lang = isValidLanguage(data.lang) ? data.lang : "es";

    const text = cleanText(data.text);

    if (!text) {
      return NextResponse.json(
        { error: "El texto está vacío." },
        { status: 400 }
      );
    }

    /*
     * Este endpoint público de Google Translate tiene límites.
     * Para esta aplicación queremos generar guiones cortos de anuncio.
     */
    if (text.length > 240) {
      return NextResponse.json(
        {
          error:
            "El guion es demasiado largo para generar la voz. Reduce la descripción del producto.",
        },
        { status: 400 }
      );
    }

    const audio = await googleTranslateTTS(text, lang);

    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[TTS ERROR]", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo generar el audio.";

    return NextResponse.json(
      {
        error: `No se pudo generar la voz: ${message}`,
      },
      { status: 502 }
    );
  }
}
