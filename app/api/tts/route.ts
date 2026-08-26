import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, lang = "es-ES" } = await req.json(); // Puedes cambiar a "en-US", "es-MX", etc.
    
    // Google TTS solo permite 200 caracteres por petición, así que troceamos el guion
    const words = text.replace(/[*#_~]/g, "").split(' ');
    const chunks: string[] = [];
    let currentChunk = "";

    for (const word of words) {
      if ((currentChunk + " " + word).length > 150) {
        chunks.push(currentChunk);
        currentChunk = word;
      } else {
        currentChunk += (currentChunk ? " " : "") + word;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    // Descargamos el audio real de cada trozo de texto
    const buffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        buffers.push(arrayBuffer);
      }
    }

    // Unimos todos los audios en un único archivo MP3 gigante
    const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
    const finalBuffer = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const b of buffers) {
      finalBuffer.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    return new NextResponse(finalBuffer, {
      headers: { 'Content-Type': 'audio/mpeg' }
    });

  } catch (error) {
    console.error("Error TTS:", error);
    return NextResponse.json({ error: "Fallo al generar la voz" }, { status: 500 });
  }
}
