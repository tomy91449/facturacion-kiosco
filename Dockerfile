# ── Etapa 1: compilar TypeScript y generar el cliente Prisma para Linux ──
FROM node:20-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Electron no se usa en el contenedor: no descargar su binario
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build


# ── Etapa 2: imagen final, solo dependencias de producción ──
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATABASE_URL=file:/app/data/pos.db

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public

# La base SQLite vive en un volumen para no perderse al actualizar la imagen
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

# No correr como root
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Aplica las migraciones pendientes y arranca el servidor
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
