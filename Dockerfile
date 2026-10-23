# Productie-image: Node 22 + ffmpeg (verplicht voor de inhoudscontrole van uploads).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    STUDIO_REVIEW_HOME=/data-home \
    LANG=C.UTF-8
RUN mkdir -p /data /backups /data-home && chown node:node /data /backups /data-home
VOLUME ["/data", "/backups"]
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.database==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
