import { SubtitleCue } from "@/types";

export async function generateSpeechAndCues(
  text: string,
  targetDurationSec: number
): Promise<{ audioBlob: Blob; cues: SubtitleCue[] }> {
  
  const cleanText = text.replace(/[*#_~]/g, "").trim();
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) throw new Error("Guion vacío");

  const timePerWord = targetDurationSec / rawWords.length;
  const cues: SubtitleCue[] = [];
  
  for (let i = 0; i < rawWords.length; i += 3) {
    const chunk = rawWords.slice(i, i + 3);
    cues.push({
      id: i,
      text: chunk.join(" "),
      start: i * timePerWord,
      end: (i + chunk.length) * timePerWord,
      words: chunk.map((word, idx) => ({
        text: word,
        start: (i + idx) * timePerWord,
        end: (i + idx + 1) * timePerWord,
      })),
    });
  }

  // LLAMADA AL NUEVO BACKEND DE VOZ REAL
  // Le pasamos el texto y el idioma. Puedes poner "en-US" para inglés.
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: cleanText, lang: "es-ES" }) 
  });

  if (!res.ok) {
    throw new Error("No se pudo obtener la voz de la IA.");
  }

  // Obtenemos el archivo MP3 real
  const audioBlob = await res.blob();

  return { audioBlob, cues };
}
