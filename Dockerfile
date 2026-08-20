FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     chromium \
     fonts-liberation \
     fonts-noto-color-emoji \
     ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY . .

RUN npm run build
RUN npm prune --omit=dev

ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 3000

CMD ["sh", "-c", "next start -p ${PORT:-3000}"]