import { NextResponse } from "next/server";

type LanguageCode = "es" | "en" | "pt" | "fr";

const LANGUAGE_MAP: Record<LanguageCode, string> = {
  es: "es",
  en: "en",
  pt: "pt",
  fr: "fr",
};

const SE_VOICES: Record<LanguageCode, string> = {
  es: "Mia",
  en: "Brian",
  pt: "Vitoria",
  fr: "Celine",
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

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "audio/mpeg,audio/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "La petición TTS contiene JSON inválido." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "La petición TTS no es válida." }, { status: 400 });
    }

    const data = body as Record<string, unknown>;

    if (typeof data.text !== "string") {
      return NextResponse.json({ error: "El texto es obligatorio." }, { status: 400 });
    }

    const lang = isValidLanguage(data.lang) ? data.lang : "es";
    const text = cleanText(data.text);

    if (!text) {
      return NextResponse.json({ error: "El texto está vacío." }, { status: 400 });
    }

    if (text.length > 280) {
      return NextResponse.json(
        { error: "El guion es demasiado largo para generar la voz." },
        { status: 400 }
      );
    }

    const encodedText = encodeURIComponent(text);
    
    // Lista de proveedores en servidor (Inmune a AdBlockers del usuario)
    const urls = [
      `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${LANGUAGE_MAP[lang]}&q=${encodedText}`,
      `https://api.streamelements.com/kappa/v2/speech?voice=${SE_VOICES[lang]}&text=${encodedText}`
    ];

    let audioBuffer: ArrayBuffer | null = null;
    let lastError = "El proveedor de voz no respondió.";

    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(url);

        if (!response.ok) {
          lastError = `Proveedor HTTP ${response.status}.`;
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();

        // 200 bytes mínimo (1000 era demasiado y fallaba con frases cortas)
        if (arrayBuffer.byteLength < 200) {
          lastError = "El proveedor devolvió un archivo demasiado pequeño.";
          continue;
        }

        audioBuffer = arrayBuffer;
        break; // Éxito
      } catch (error) {
        if (error instanceof Error) {
          lastError = error.name === "AbortError" ? "Timeout del proveedor." : error.message;
        }
      }
    }

    if (!audioBuffer) {
      throw new Error(lastError);
    }

    // Se usa Uint8Array para asegurar compatibilidad total en Next.js (sin 'Buffer' de Node)
    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[TTS ERROR]", error);
    const message = error instanceof Error ? error.message : "No se pudo generar el audio.";
    return NextResponse.json({ error: `No se pudo generar la voz: ${message}` }, { status: 502 });
  }
}
