# ---------- Stage 1: build the Vue client ----------
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build          # -> /app/client/dist

# ---------- Stage 2: build the TypeScript server ----------
FROM node:22-bookworm-slim AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build          # -> /app/server/dist

# ---------- Stage 3: production dependencies (compiles better-sqlite3) ----------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app/server
# Build toolchain in case a prebuilt better-sqlite3 binary isn't available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 4: runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3021 \
    DB_PATH=/app/server/data/uptime.db \
    CLIENT_ORIGIN=*
WORKDIR /app/server

# Ping monitors shell out to the system `ping` binary (via the `ping` npm
# package), which is NOT included in the slim base image. Install it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping \
  && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps   /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist        ./dist
COPY server/package.json ./
# The Express server serves these static files in production.
COPY --from=client      /app/client/dist         ./public

# SQLite data lives here; declare it as a volume for persistence.
RUN mkdir -p /app/server/data
VOLUME /app/server/data

EXPOSE 3021
CMD ["node", "dist/index.js"]
