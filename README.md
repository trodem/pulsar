# Pulsar

A self-hosted uptime monitor inspired by [Uptime Kuma](https://github.com/louislam/uptime-kuma),
built with an Express + TypeScript backend, a Vue 3 frontend, and a SQLite database.

## Features

- Monitor types: **HTTP(s)**, **TCP port**, **Ping**
- **Groups** (dashboard sections) and colored **tags** with tag-based filtering
- Per-monitor interval, timeout, retries, and accepted status codes
- Live dashboard over **WebSocket** (Socket.IO): heartbeat bars, 24h uptime %, latency
- History / event log of up⇄down transitions
- **Notifications** on state change: Webhook and Telegram (with test button)
- Single-admin **authentication** (JWT + bcrypt), first-run setup wizard
- Zero-config **SQLite** storage (tables auto-created on boot)

## Tech stack

| Layer     | Tech                                                        |
| --------- | ----------------------------------------------------------- |
| Backend   | Node.js, Express, TypeScript, Socket.IO                     |
| Database  | SQLite via `better-sqlite3` + Drizzle ORM                   |
| Scheduler | In-process per-monitor timers                               |
| Frontend  | Vue 3, Vite, Pinia, Vue Router, `socket.io-client`, TS      |

## Project layout

```
server/   Express API, checkers, scheduler, Socket.IO, SQLite
client/   Vue 3 SPA (dashboard, monitor editor, notifications)
```

## Getting started

### 1. Backend

```bash
cd server
npm install
cp .env.example .env        # optional: change JWT_SECRET / PORT
npm run dev                 # http://localhost:3021
```

The SQLite file is created automatically at `server/data/uptime.db`.

### 2. Frontend

```bash
cd client
npm install
npm run dev                 # http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to the backend, so just open
http://localhost:5173 and create your admin account on first run.

## Production build

```bash
cd server && npm run build && npm start     # serves API on PORT
cd client && npm run build                  # static files in client/dist
```

Serve `client/dist` behind any static host / reverse proxy pointing `/api`
and `/socket.io` at the backend.

## Docker

A multi-stage `Dockerfile` builds the client and server and produces a single
image where **Express serves both the API/WebSocket and the static frontend**
on one port. The SQLite database is persisted on a named volume.

The image is built **locally by docker compose** — nothing is pushed to any
registry. Only the base `node` image is pulled from Docker Hub during the build.

### Run

```bash
docker compose up -d --build
```

Then open http://localhost:3021 and create your admin account.
Stop with `docker compose down` (add `-v` to also wipe the database volume).

Edit the environment in `docker-compose.yml` before going to production:

| Variable        | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `JWT_SECRET`    | **Change this** — signs auth tokens.                          |
| `CLIENT_ORIGIN` | `*` reflects any origin; set to your public URL to lock down. |
| `PORT`          | Listen port inside the container (default `3021`).            |
| `DB_PATH`       | SQLite file path (default `/app/server/data/uptime.db`).      |

The database lives in the `uptime-data` volume, so it survives
`docker compose down` / image rebuilds. Remove it with
`docker compose down -v` for a clean slate.

## Notes

- Ping uses the system `ping` binary (via the `ping` package), so it works
  without elevated privileges on Windows/Linux/macOS.
- Notifications fire only on a genuine state transition (up→down / down→up),
  matching Uptime Kuma's behaviour.
