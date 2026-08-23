# Servidor de voz — despliegue en 5 minutos

El navegador nunca ve claves. Este worker guarda las credenciales y expone
`/tts`, `/llm` y `/stt`.

## Pasos

```bash
npm install -g wrangler
wrangler login

# Secretos (NUNCA en el código ni en el bundle):
wrangler secret put ELEVENLABS_API_KEY   # pega tu clave de elevenlabs.io
wrangler secret put GROQ_API_KEY         # pega tu clave de console.groq.com (gratis)

# Publicar:
wrangler deploy
```

Al terminar, wrangler muestra la URL, por ejemplo:
`https://clipcraft-voice.tu-cuenta.workers.dev`

## Conectar la web

Edita `public/config.js`:

```js
window.__CLIPCRAFT__ = { apiBaseUrl: "https://clipcraft-voice.tu-cuenta.workers.dev" };
```

y haz commit + push (GitHub Pages lo publica automáticamente).

Alternativa sin tocar config.js: define el secreto `NEXT_PUBLIC_TTS_API_URL`
en build. Pero `public/config.js` es preferible porque se puede cambiar sin
recompilar.

## Opcional: restringir CORS

```bash
wrangler secret put ALLOWED_ORIGIN   # https://3737631.github.io
```

## Verificar

```bash
curl https://clipcraft-voice.tu-cuenta.workers.dev/health
# {"ok":true,"tts":true,"llm":true}
```
