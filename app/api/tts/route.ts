import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, lang = "es-ES" } = await req.json();
    
    // El servidor se disfraza de navegador normal para pedirle la voz a Google
    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
    
    const res = await fetch(url, { 
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://translate.google.com/'
        } 
    });
    
    if (!res.ok) throw new Error("Google rechazó la petición del servidor");
    
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, { headers: { 'Content-Type': 'audio/mpeg' } });
    
  } catch (error) {
    return NextResponse.json({ error: "Fallo interno en el puente TTS" }, { status: 500 });
  }
}
