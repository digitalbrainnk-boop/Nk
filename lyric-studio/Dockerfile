# Lyric Studio prêt à héberger : Node 22 + ffmpeg (+ Demucs en option : --build-arg WITH_DEMUCS=1,
# image bien plus grosse et serveur de 8 Go de mémoire conseillé).
FROM node:22-bookworm-slim

ARG WITH_DEMUCS=0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && if [ "$WITH_DEMUCS" = "1" ]; then \
       apt-get install -y --no-install-recommends python3 python3-pip \
       && pip3 install --break-system-packages --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
       && pip3 install --break-system-packages --no-cache-dir demucs; \
     fi \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public

ENV NODE_ENV=production PORT=3500 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 3500
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3500/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
