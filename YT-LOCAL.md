# Descargar fragmentos virales reales de YouTube (máxima calidad, gratis)

La app no puede descargar YouTube desde Vercel porque YouTube **bloquea las IPs de los servidores** (datacenter) y solo da los vídeos reales a IPs residenciales (la tuya). Por eso el método es descargar el fragmento en **tu PC** (gratis, sin tarjeta, máxima calidad) y luego subirlo en la app.

## Requisitos (una sola vez)
1. **yt-dlp**: `python -m pip install yt-dlp`
2. **ffmpeg** en el PATH (ya lo tienes si instalaste ffmpeg; si no: descárgalo de https://ffmpeg.org y añádelo al PATH)
3. **Node.js** (ya lo usas)

## Uso

```powershell
node yt-local.mjs "https://www.youtube.com/shorts/ID" [duracion]
```

- `duracion` (opcional): segundos del fragmento (mín 4, máx 15, default 10)
- Guarda el archivo en `yt-descargas/`

### Ejemplos
```powershell
# fragmento de 10s
node yt-local.mjs "https://www.youtube.com/shorts/9FDVvWR91ww"

# fragmento de 12s
node yt-local.mjs "https://www.youtube.com/watch?v=9FDVvWR91ww&t=20" 12
```

## En la app
1. Abre la app → sección **"O sube tus vídeos"** → **Seleccionar vídeos** (elige el fragmento que bajaste, puedes subir varios)
2. Se avanza a "Elige modo" → **🎙️ Voz**
3. Escribe/ajusta el guion, idioma y duración
4. **Crear Vídeo** → obtienes el viral con el fragmento real en máxima calidad

Es 100% gratis y sin tarjeta de crédito.
