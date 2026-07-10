# syntax=docker/dockerfile:1

# --- Build stage: compile TypeScript -> dist/ ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install all deps (incl. dev) using the lockfile for a reproducible build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Reduce node_modules to production-only for the runtime image.
RUN npm prune --omit=dev

# --- Runtime stage ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `ping`/`http-ping` monitors shell out to the system ping binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# SQLite database lives here; mount a volume to persist it (DB_PATH=./data/uptime.db).
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3021
CMD ["node", "dist/index.js"]
