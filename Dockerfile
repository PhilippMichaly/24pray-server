FROM node:22-slim AS build
# Prisma erkennt die OpenSSL-Version, um die passende Engine zu waehlen (R4)
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
COPY deploy/docker-entrypoint.sh ./docker-entrypoint.sh
# Im Container muss die API auf allen Interfaces lauschen (Default ist Loopback, N9).
ENV HOST=0.0.0.0
# Nicht als root laufen (A11e). DATA_DIR (Default ./data) muss fuer node beschreibbar sein:
# server.ts legt es an, prisma migrate deploy schreibt die SQLite-DB hinein.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
# exec-Form ohne sh -c: das Entrypoint-Skript ersetzt sich per exec durch Node,
# SIGTERM erreicht also die API (R4).
CMD ["./docker-entrypoint.sh"]
