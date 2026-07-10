# Pulsar

A self-hosted uptime monitor inspired by [Uptime Kuma](https://github.com/louislam/uptime-kuma),
built with an Express + TypeScript backend, a Vue 3 frontend, and a SQLite database.

## Features

- Monitor types: **HTTP(s)**, **TCP port**, **Ping**
- **Groups** (dashboard sections) and colored **tags** with tag-based filtering
- Per-monitor interval, timeout, retries, and accepted status codes
- Live dashboard over **WebSocket** (Socket.IO): heartbeat bars, 24h uptime %, latency
- History / event log of up⇄down transitions
- **Notifications** on state change: Webhook, Telegram, and Microsoft Teams
  (with test button), each targetable at individual monitors and/or whole groups
- Single-admin **authentication** (JWT + bcrypt), first-run setup wizard
- Zero-config **SQLite** storage (tables auto-created on boot)

## Tech stack

| Layer     | Tech                                                        |
| --------- | ----------------------------------------------------------- |
| Backend   | Node.js, Express, TypeScript, Socket.IO                     |
| Database  | SQLite via libSQL (`@libsql/client`) + Drizzle ORM          |
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

`docker compose` runs **two services**, each with its own multi-stage
`Dockerfile`:

- **server** — Node/Express API + Socket.IO on port `3021`. The runtime image
  installs `iputils-ping` (for `ping` / `http-ping` monitors) and persists the
  SQLite database on the `pulsar-data` named volume.
- **client** — the Vue SPA built to static files and served by **nginx**, which
  reverse-proxies `/api` and `/socket.io` to the server. The browser therefore
  talks to a single origin (no CORS), and the app is published on port `8090`
  (override with `WEB_PORT` in `.env`).

Images are built **locally by docker compose** — nothing is pushed to any
registry. Only the base `node` / `nginx` images are pulled during the build.

### Run

```bash
cp .env.example .env          # set JWT_SECRET (compose refuses to start without it)
docker compose up -d --build
```

Then open http://localhost:8090 and create your admin account.
Stop with `docker compose down` (add `-v` to also wipe the database volume).

Environment is read from `.env` and passed to the **server** service in
`docker-compose.yml`:

| Variable            | Purpose                                                      |
| ------------------- | ----------------------------------------------------------- |
| `JWT_SECRET`        | **Required** — signs auth tokens; compose fails if unset.   |
| `DB_PATH`           | SQLite file path inside the container (default `./data/uptime.db`). |
| `STAP_LOG_ENABLED`  | STAP logged-user extraction; `net use`/SMB is Windows-only, so this has no effect in the Linux container. |
| `STAP_LOG_UNC` / `STAP_LOG_USER` / `STAP_LOG_PASSWORD` | STAP share + credentials (optional). |

`CLIENT_ORIGIN` is fixed to `*` for the server because nginx proxies
same-origin. The ICMP `ping` needs the raw-socket capability, so the server
service is granted `cap_add: [NET_RAW]`. The API port is not published to the
host by default (only nginx reaches it over the internal network) — uncomment
the `ports` block in `docker-compose.yml` to expose `3021` directly.

The database lives in the `pulsar-data` volume, so it survives
`docker compose down` / image rebuilds. Remove it with
`docker compose down -v` for a clean slate.

## Notes

- Ping uses the system `ping` binary (via the `ping` package), so it works
  without elevated privileges on Windows/Linux/macOS.
- Notifications fire only on a genuine state transition (up→down / down→up),
  matching Uptime Kuma's behaviour.
