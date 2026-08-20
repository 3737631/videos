# AliProbe

Analizador de productos de AliExpress construido con **Next.js 15**: pega un enlace de producto y extrae la ficha, el precio, las imagenes, los atributos y la **informacion de conformidad del fabricante** (fabricante, direccion, CE/RoHS, modelo, etc.).

## Como funciona

1. El usuario pega una URL de AliExpress en `/`.
2. Un backend con **Puppeteer** (Chromium headless) abre la pagina y **intercepta la respuesta de la API interna** `mtop.aliexpress.pdp.pc.query` — asi obtiene los datos estructurados sin firmar peticiones a mano.
3. Se extraen titulo, precio, imagenes, vendedor y atributos; los atributos con palabras clave de conformidad (fabricante, marca, direccion, CE, RoHS, modelo...) se marcan aparte.
4. El resultado se guarda en la base de datos y aparece en `/history`.

## Base de datos

- **Por defecto: SQLite local** en `data/app.db` (creada automaticamente en el primer uso).
- Si defines `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, usa **Supabase** con la tabla `products`.

## Local

```bash
npm install
npm run dev
```

La app arranca en `http://localhost:3000`. Windows usa Edge/Chrome del sistema (auto-detectado); Linux usa `/usr/bin/chromium`.

## Despliegue (Docker / Railway)

El `Dockerfile` instala Chromium, hace `npm ci --include=dev` (necesario porque Tailwind esta en devDependencies) y arranca con `next start -p $PORT` (Railway inyecta `PORT`). El codigo asume el `Dockerfile` en la raiz del repo.

### Railway

1. Sube el codigo a un repo de GitHub (rama `main`).
2. En Railway: **New Project -> Deploy from GitHub** -> elige el repo.
3. Railway detecta el `Dockerfile`, construye y publica la URL automaticamente.
4. Opcional: variables `SCRAPERAPI_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

> Nota: Railway ya no tiene plan gratuito 24/7; el arranque consume el credito de prueba de la cuenta.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Activa modo Supabase (si se define junto a la clave) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase |
| `SCRAPERAPI_KEY` | Proxy residencial de ScraperAPI (opcional, evita bloqueos) |
| `CHROME_PATH` | Ruta manual al navegador (opcional) |
| `PORT` | Puerto de `next start` (Railway lo inyecta) |

## API

- `POST /api/extract` con `{ "url": "..." }` -> extrae, guarda y devuelve el producto.
- `GET /api/history` -> lista los productos guardados.
- `DELETE /api/history/:id` -> borra un producto.
