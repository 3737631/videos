// Descarga fragmentos virales reales de YouTube en MÁXIMA CALIDAD (gratis, sin tarjeta).
// Se ejecuta en TU PC por su IP residencial (YouTube bloquea las IPs de servidor/Vercel).
//
// Requisitos (una sola vez):
//   pip install yt-dlp          (o: python -m pip install yt-dlp)
//   tener ffmpeg en el PATH     (o poner su ruta abajo)
//   tener Node.js (ya lo usas)
//
// Uso:
//   node yt-local.mjs "https://www.youtube.com/shorts/ID" [duracion] [destino]
//   - duracion : segundos del fragmento (default 10, max 15) (opcional)
//   - destino  : carpeta donde guardar (default "yt-descargas")
//
// Ejemplo:
//   node yt-local.mjs "https://www.youtube.com/shorts/9FDVvWR91ww" 12
//
// Después sube el fragmento en la app con "O sube tus vídeos" y dale a Crear Vídeo.

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";

const [,, rawUrl, durArg, outArg] = process.argv;
const url = rawUrl || (await (async () => { process.stdout.write("Pega el enlace de YouTube: "); const { stdin } = process; return new Promise((r) => { stdin.once("data", (d) => r(d.toString().trim())); }); })());
const duration = Math.min(15, Math.max(4, parseInt(durArg || "10", 10) || 10));
const outDir = outArg || path.join(process.cwd(), "yt-descargas");

const idMatch = (/(?:v=|shorts\/|youtu\.be\/|^)([A-Za-z0-9_-]{11})(?=$|[?&#])/.exec(url));
const id = (idMatch && idMatch[1]) || "";
if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { console.error("✗ No encontré el ID del vídeo en:", url); process.exit(1); }

mkdirSync(outDir, { recursive: true });

const nodePath = process.execPath;
const jsRuntime = `node:${nodePath}`;
const cleanF = (s) => s.replace(/[\\/:*?"<>|#]/g, "_").replace(/[^\x20-\x7E]/g, "_");

function sh(cmd) {
  console.log("$", cmd);
  execSync(cmd, { stdio: "inherit" });
}

console.log(`\n== Descargando "${url}" en máxima calidad ==`);
const fullFile = path.join(outDir, `yt-full-${id}.mp4`);
sh(`yt-dlp --js-runtimes "${jsRuntime}" --remote-components ejs:github -f "bv*+ba/b" --merge-output-format mp4 -o "${fullFile}" "${url}"`);

if (!existsSync(fullFile)) { console.error("✗ No se generó el vídeo. Revisa el enlace (debe ser público)."); process.exit(1); }

const clipFinal = path.join(outDir, `yt-${id}-${duration}s.mp4`);
console.log(`\n== Recortando fragmento de ${duration}s ==`);
sh(`ffmpeg -y -ss 0 -t ${duration} -i "${fullFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -movflags +faststart "${clipFinal}"`);

console.log(`\n✔ Listo para subir: ${clipFinal}`);
console.log("   Ábrelo en la app → 'O sube tus vídeos' → Crear Vídeo con Voz.\n");
console.log("Los fragmentos se guardan en:", outDir);
