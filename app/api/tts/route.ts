import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, lang = "es" } = await req.json();
    const cleanText = (text || "¡Increíble producto!").slice(0, 300);
    
    const langMap: Record<string, string> = {
      es: "es-ES",
      en: "en-US",
      pt: "pt-BR",
      fr: "fr-FR"
    };
    const targetLang = langMap[lang] || "es-ES";

    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 500) {
        return new NextResponse(arrayBuffer, {
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      }
    }

    const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Mia&text=${encodeURIComponent(cleanText)}`;
    const seRes = await fetch(seUrl);
    if (seRes.ok) {
      const buf = await seRes.arrayBuffer();
      if (buf.byteLength > 500) {
        return new NextResponse(buf, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
    }

    throw new Error("TTS unavailable");
  } catch (error) {
    return NextResponse.json({ error: "Failed to generate speech" }, { status: 500 });
  }
}
