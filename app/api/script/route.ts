import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { productInfo, durationSeconds } = await req.json();

    const duration = Math.max(5, Math.min(60, Number(durationSeconds) || 15));
    const targetWordCount = Math.round(duration * 3); // 3 palabras por seg para ritmo TikTok

    // Filtro estricto
    const cleanInfo = productInfo
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/(aliexpress|amazon|shein|temu|tienda|comprar|vendedor|descuento)/gi, "")
      .trim() || "este increíble producto";

    // Guion viral simulado ajustado al tiempo
    let fullText = `¡Deja de perder el tiempo! Con ${cleanInfo}, todo se hace tres veces más rápido. Solo tienes que aplicarlo y verás cómo elimina cualquier problema sin esfuerzo ni complicaciones. ¡Una auténtica locura de resultado, pruébalo y notarás la diferencia al instante!`;
    
    let words = fullText.split(/\s+/);
    if (words.length > targetWordCount) {
      words = words.slice(0, targetWordCount);
    } else {
      while (words.length < targetWordCount) {
        words.push("¡Funciona de verdad!");
      }
    }

    return NextResponse.json({
      success: true,
      script: words.join(" "),
      duration: duration,
    });
  } catch (error) {
    return NextResponse.json({ error: "Error procesando el guion" }, { status: 500 });
  }
}
