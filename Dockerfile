FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
# Im Container muss die API auf allen Interfaces lauschen (Default ist Loopback, N9).
ENV HOST=0.0.0.0
# Nicht als root laufen (A11e). DATA_DIR (Default ./data) muss fuer node beschreibbar sein:
# server.ts legt es an, prisma migrate deploy schreibt die SQLite-DB hinein.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
