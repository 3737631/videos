# AGENTS.md — ClipCraft / Muse Spark

> Reglas operativas para que OpenCode trabaje como agente autónomo y fiable. Fuente de verdad: código actual, `git`, GitHub Actions y producción. Nada de suposiciones.

## 0) Contexto del proyecto

- **Repositorio:** `3737631/videos` — `C:\Users\Paquito\Downloads\wifi\videos` — rama `main` — `origin https://github.com/3737631/videos.git`
- **Stack:** Next.js 15.3.4 + React 19.1 + TypeScript 5.8 + Tailwind 4 + onnxruntime-web 1.20.1 + piper-tts-web
- **Package manager:** `npm` (`package-lock.json` presente)
- **Scripts:** `npm run dev` (next dev), `npm run build` (next build → `out/`), `npm start`, `npm run lint` (next lint), `npm run typecheck` (`tsc --noEmit`), `npm test` (`tsx tests/run.ts` → 41 tests)
- **Deploy:** GitHub Pages vía `.github/workflows/pages.yml` (`Deploy to GitHub Pages`, `push: branches: [main]` + `workflow_dispatch`, `npm ci` + `npm run build` + `upload-pages-artifact: out` + `deploy-pages@v4`, concurrency `group: pages / cancel-in-progress: true`). URL: `https://3737631.github.io/videos/`
- **Estructura:** `app/` (App Router), `components/`, `lib/` (pipeline, voices, audio, video, product, niche, script), `public/` (`piper/`, `voices/`), `tests/`, `out/`

---

## 1) Reglas generales

- Nunca inventar resultados. Nunca afirmar que algo está hecho sin haberlo comprobado con herramienta real.
- Nunca afirmar que está desplegado sin comprobar GitHub Actions con SHA correcto.
- Nunca afirmar que producción está actualizada sin comprobar la URL real y el JS/HTML generado.
- No crear commits artificiales, vacíos, ni archivos falsos (README, CHANGELOG, VERSION, comentarios) solo para provocar un deploy.
- No tocar código no relacionado con la tarea. No hacer refactors innecesarios ni cambiar arquitectura, estilos o comportamiento no pedido.
- Mantener compatibilidad con código existente. Conservar APIs, componentes, rutas, estilos y funcionalidades que no forman parte de la tarea.
- Cada tarea que afecte al proyecto debe terminar en: **CAMBIO → TEST/BUILD → GIT → PUSH → GITHUB ACTIONS SUCCESS → PRODUCCIÓN VERIFICADA**.

## 2) Antes de modificar

1. Leer los archivos relevantes (`Read`).
2. Buscar todas las referencias (`Grep`/`Glob`) a la funcionalidad.
3. Comprender cómo funciona actualmente y si ya existe implementación parcial.
4. Identificar causa raíz (no intuición).
5. Comprobar `git status` y `git diff` para partir de estado limpio.

## 3) Durante la modificación

- Hacer el cambio mínimo necesario. Un solo objetivo por commit.
- Preservar `app/` rutas, `lib/` APIs, estilos, compatibilidad móvil y Safari/iPhone (ver §4).
- Si un cambio puede romper otra funcionalidad, comprobarla explícitamente (tests/build).
- No eliminar verificaciones ni ocultar errores con timeouts aleatorios.

## 4) Regla especial — Compatibilidad

Debe funcionar en **Chrome, Safari, iPhone/iOS, Android, desktop**. Atención máxima a:

- Safari / iOS: `MediaRecorder`, `canvas`, `OffscreenCanvas`, `AudioContext`/`OfflineAudioContext`, `Blob`, `fetch`, `CORS`, `WebAssembly (ORT)`, `IndexedDB`/`Cache API`, `viewport`/`safe-area`, `WebWorker` (`PhonemizeWebWorker.js`).
- No asumir que algo que funciona en Chrome funciona en Safari. Probar con `isMobileLike` y fallbacks existentes (`lib/video/canvasRender.ts`, `lib/voices/piperRuntime.ts`).

## 5) Después de modificar

Ejecutar, en orden y solo si aplica:
```bash
npx tsc --noEmit
npm run lint
npm test          # o npm.cmd test en PowerShell
npm run build     # verifica que exporta a out/
```
Luego:
```bash
git diff
git status
```
Confirmar que el cambio soluciona el problema sin romper otros flujos.

## 6) Git

Si hay cambios reales relacionados con la tarea:
```bash
git status
git diff
git add <archivos-reales>
git commit -m "fix: descripción concisa en español"
git push origin main
```
- Añadir **solo** archivos de la solución.
- Mensajes descriptivos (`fix:`, `feat:`, `chore:`). Ej: `fix: fix video rendering on iOS`.
- No crear commits artificiales, no tocar `README`/`version.txt` para forzar deploy, no commits vacíos.

## 7) GitHub Actions

Tras `push`, identificar workflow real en `.github/workflows/pages.yml` (nombre: `Deploy to GitHub Pages`):

```bash
# Comprobar run del commit correcto (PowerShell)
Invoke-RestMethod -Uri 'https://api.github.com/repos/3737631/videos/actions/runs?branch=main&per_page=1' -Headers @{'Accept'='application/vnd.github+json'} | Select-Object -ExpandProperty workflow_runs | Select-Object head_sha,status,conclusion,html_url
```

Estados: `queued` → `in_progress` → `completed`. Conclusión debe ser `success`. **No decir "deploy realizado" mientras esté `queued`/`in_progress`/`failure`**. Si falla: abrir logs, corregir, commit, push, re-comprobar hasta `SUCCESS`.

## 8) Si los cambios ya están en `main`

- **No crear otro commit artificial.**
- Si el workflow soporta `workflow_dispatch` (sí lo soporta), ejecutarlo sobre el SHA existente vía `gh workflow run` o API.
- Si no, usar el método correcto para re-desplegar el commit existente (nunca `commit --allow-empty`).

## 9) Producción

Cuando Actions esté `SUCCESS`:
- Comprobar la deployment SHA coincide: `https://api.github.com/repos/3737631/videos/deployments?per_page=1`
- Abrir producción: `https://3737631.github.io/videos/crear`
- Extraer chunk JS (`page-[a-f0-9]+\.js`) y verificar que contiene el string/cambio esperado (ej. `Invoke-RestMethod ... page-*.js | Select-String "Voz"`).
- Si el cambio es funcional/visual, probar el flujo (ej. AliExpress `parseAliUrl`, `GENERATING_VOICE`).

No basta `SUCCESS`; la web debe contener el cambio.

## 10) Regla para deploys (OBLIGATORIA)

Cada vez que el usuario pide un cambio que afecta al proyecto **con deploy automático**:

```
CAMBIO → TEST/BUILD → GIT diff/status → COMMIT → PUSH → GITHUB ACTIONS (esperar) → SUCCESS → PRODUCCIÓN (comprobar URL/JS) → VERIFICACIÓN
```

No detenerse a mitad. No responder "he hecho los cambios" sin haber completado la cadena.

## 11) Si el usuario dice "arréglalo"

- No preguntar "¿quieres que continúe?".
- No decir "el siguiente paso sería…".
- Ejecutar directamente. Si tu propio cambio provocó otro error, corregirlo en el mismo flujo.

## 12) Si no puedes hacer algo

No inventar. Explicar exactamente: qué comando intentaste, qué error apareció, qué parte falta y qué necesitas, **después** de haber intentado todas las soluciones razonables.

## 13) Respuesta final

Cuando **todo** esté terminado y verificado:
```
SOLUCIONADO Y DESPLEGADO ✓
- Cambios: <resumen breve>
- Commit: <SHA corto>
- GitHub Actions: SUCCESS ✓ (<url run>)
- Producción: VERIFICADA ✓ (<url> + evidencia chunk)
```
Si algo falta, **no** usar `SOLUCIONADO Y DESPLEGADO`; indicar qué falta.

## 14) Contexto y memoria

- No repetir inspecciones ya hechas en la misma tarea si no es necesario.
- Pero tampoco confiar en mensajes anteriores: la fuente de verdad es `código actual` + `git` + `Actions` + `producción`.
- Para tareas grandes, dividir en fases: inspección → diagnóstico → implementación → verificación → git → deploy → producción.

## 15) Sobre el modelo

- No compensar limitaciones con respuestas enormes.
- Priorizar **acciones** (herramientas ejecutadas) sobre explicaciones. Una herramienta real vale más que 10 párrafos.
- Pensamiento mínimo necesario (`reasoning_effort: low`) salvo que el usuario pida `usa razonamiento máximo`.

---
*Este archivo es cambio REAL de configuración del agente y debe versionarse. Commit: `chore: configure coding agent workflow` (una sola vez).*
