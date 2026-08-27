import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, lang = "es" } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "El texto es obligatorio" }, { status: 400 });
    }
    const cleanText = text.slice(0, 400);

    const langMap: Record<string, string> = {
      es: "es-ES",
      en: "en-US",
      pt: "pt-BR",
      fr: "fr-FR"
    };
    const targetLang = langMap[lang] || "es-ES";

    // Intento 1: Google Translate TTS vía servidor
    const googleUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    let res = await fetch(googleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 500) {
        return new NextResponse(buf, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
    }

    // Intento 2: StreamElements Amazon Polly
    const voiceMap: Record<string, string> = {
      es: "Mia",
      en: "Brian",
      pt: "Vitoria",
      fr: "Celine"
    };
    const voice = voiceMap[lang] || "Mia";
    const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodeURIComponent(cleanText)}`;
    res = await fetch(seUrl);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 500) {
        return new NextResponse(buf, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
    }

    return NextResponse.json({ error: "Los servicios de TTS externos no respondieron correctamente." }, { status: 502 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno en el servidor de TTS" }, { status: 500 });
  }
}
