FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV WHISPER_COMMAND=/opt/clipforge-venv/bin/whisper
ENV ESPEAK_NG_PATH=/usr/bin/espeak-ng

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    espeak-ng \
    python3 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/clipforge-venv \
  && /opt/clipforge-venv/bin/python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/clipforge-venv/bin/python -m pip install --no-cache-dir openai-whisper

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build \
  && npm prune --omit=dev

EXPOSE 10000

CMD ["node", "scripts/render-runtime.mjs"]
