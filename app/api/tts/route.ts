import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, lang = "es" } = await req.json();
    const cleanText = (text || "").slice(0, 250);
    
    const langMap: Record<string, string> = {
      es: "es-ES",
      en: "en-US",
      pt: "pt-BR",
      fr: "fr-FR"
    };
    const targetLang = langMap[lang] || "es-ES";

    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    if (!res.ok) {
      const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Mia&text=${encodeURIComponent(cleanText)}`;
      const seRes = await fetch(seUrl);
      if (seRes.ok) {
        const buf = await seRes.arrayBuffer();
        return new NextResponse(buf, { headers: { 'Content-Type': 'audio/mp3' } });
      }
      throw new Error("External TTS failed");
    }

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, { headers: { 'Content-Type': 'audio/mpeg' } });
  } catch (err) {
    return NextResponse.json({ error: "TTS error" }, { status: 500 });
  }
}
