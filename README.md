# ClipCraft

Aplicación web completa de **edición y generación automática de vídeos cortos verticales con IA** (9:16). Sube tu vídeo, la IA lo analiza, genera el guion, la locución, los subtítulos sincronizados y la edición automática, y lo exporta en MP4 listo para TikTok, Instagram Reels y YouTube Shorts.

Publicada en: **https://3737631.github.io/videos/**

## Cómo funciona

1. **Sube tu vídeo** (MP4, MOV, WEBM o AVI). Todo el procesamiento ocurre en tu navegador con FFmpeg WASM; no se sube nada a un servidor.
2. **La IA lo analiza**: detecta escenas, personas, producto, ritmo, silencios, audio y calidad.
3. **Crea el vídeo automáticamente**: genera hooks, guion (HOOK → DESARROLLO → BENEFICIO → PRUEBA → CTA), locución real, subtítulos palabra por palabra y el plan de edición.
4. **Ajusta** guion, voz, subtítulos y línea de tiempo en el editor.
5. **Exporta** MP4 1080×1920 H.264 + AAC con reencuadre 9:16, zoom dinámico, subtítulos quemados y mezcla de audio.

## Requisitos

Necesitas al menos **una clave de API** para los servicios de IA. Puedes usar proveedores distintos por servicio o la misma clave en todos.

| Servicio | Proveedores | Uso |
|---|---|---|
| LLM | OpenAI (`gpt-4o-mini`) o Groq (gratis, `llama-3.3-70b-versatile`) | Guiones, hooks, CTA |
| TTS | OpenAI (`tts-1`) o ElevenLabs | Locución |
| STT | OpenAI (`whisper-1`) o Groq (`whisper-large-v3`) | Subtítulos con timestamps |

- **Groq** es gratis y sirve para LLM y STT: https://console.groq.com
- **OpenAI**: https://platform.openai.com (requiere saldo)
- **ElevenLabs**: https://elevenlabs.io (mejor calidad de voz)

Introduce las claves en **Configuración** dentro de la app. Se guardan únicamente en tu navegador (localStorage) y se envían solo a los proveedores de IA.

## Desarrollo local

```bash
npm install
npm run dev
# http://localhost:3000
```

## Build estático (GitHub Pages)

```bash
npm run build
```

Genera la exportación estática en `out/`. El workflow `.github/workflows/pages.yml` construye y publica automáticamente en GitHub Pages al hacer push a `main`.

## Arquitectura

- **Next.js + React + TypeScript + Tailwind** (App Router, export estático).
- **FFmpeg WASM** (`@ffmpeg/ffmpeg` + `@ffmpeg/util` + `@ffmpeg/core` desde CDN) para todo el procesamiento de vídeo: reencuadre 9:16, crop, scale, zoompan, overlays de subtítulos, mezcla de audio, render y validación.
- **Sin servidor**: las claves y proyectos viven en el navegador (localStorage). GitHub Pages solo sirve archivos estáticos.
- Módulos:
  - `lib/analyze.ts` — análisis real del vídeo (frames, escenas, audio, silencio, calidad).
  - `lib/ai.ts` — LLM (hooks/guion/CTA) y STT con word timestamps.
  - `lib/tts.ts` — TTS OpenAI/ElevenLabs con validación de audio generado.
  - `lib/editplan.ts` — construcción del plan de edición y estilos de subtítulos.
  - `lib/render.ts` — pipeline FFmpeg (vídeo + subtítulos + audio) y control de calidad.
  - `lib/ffmpeg.ts` — carga y utilidades de FFmpeg WASM.
  - `lib/jobs.ts` — gestión de trabajos con progreso real.
  - `lib/storage.ts` — persistencia de proyectos y ajustes.

## Solución de problemas

- **"Servicio no configurado"**: abre Configuración y añade la clave que falta.
- **El render tarda**: la primera vez descarga FFmpeg (~31 MB desde CDN). Los renders siguientes son locales y rápidos.
- **La voz suena rara**: prueba con otro proveedor TTS (ElevenLabs suele dar mejor resultado) o ajusta la velocidad al regenerar.
- **Los subtítulos no salen**: comprueba que la clave de STT es válida y tiene crédito.
- **El export falla en el control de calidad**: pulsa "Reintentar render". El QC con ffprobe valida duración, resolución, audio y codec.

## Limitaciones conocidas

- Las claves de API se guardan en el navegador (no hay servidor en GitHub Pages). No compartas tu navegador con datos sensibles.
- Los proyectos se almacenan en localStorage del navegador. Borrar datos del sitio elimina tus proyectos.
- El render de vídeos largos puede tardar varios minutos según el equipo.