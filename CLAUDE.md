# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Pulsar** — a self-hosted uptime monitor inspired by Uptime Kuma. Express + TypeScript
backend, Vue 3 frontend, SQLite storage. A monitored fleet runs a "STAP" desktop app;
`http-ping` monitors additionally read each host's remote log to show the logged-in users.

## Architecture

Two independent packages (no root workspace — install/run each separately):

- `server/` — Express REST API + Socket.IO, per-monitor scheduler, SQLite via Drizzle ORM. ESM, run with `tsx`.
- `client/` — Vue 3 SPA (Vite, Pinia, Vue Router). Dev server proxies `/api` and `/socket.io` to the backend.

In production the server builds to `dist/` and serves the client's static build from `server/public` on a single port (see `Dockerfile`).

### Backend flow
- `src/index.ts` — boot: `initSchema()` → mount routes (`/api/auth`, `/api/monitors`, `/api/notifications`) → `initSocket()` → `startScheduler()`.
- `src/monitors/scheduler.ts` — one `setInterval` timer per active monitor. Runs `runCheck`, retries up to `monitor.retries` before marking down, writes a `heartbeats` row, emits `heartbeat` on the bus, fires notifications **only on a genuine state transition** (`important`).
- `src/monitors/checkers.ts` — `runCheck` dispatches by `monitor.type`: `http`, `tcp`, `ping`, `http-ping`. Status is `1` up (green) / `2` degraded (orange) / `0` down (red). For `http-ping`: ICMP + HTTP run in parallel; ping-down = hard down, ping-up but HTTP-fail = degraded.
- `src/events.ts` — typed in-process `EventEmitter` (`bus`) decoupling the scheduler from Socket.IO (avoids a circular import).
- `src/socket.ts` — authenticates the socket handshake with the same JWT as REST, forwards `heartbeat` and `monitor:users` events to all clients.
- `src/monitors/stap-users.ts` — **http-ping only.** Reads each host's remote log over a UNC/SMB share (`net use IPC$` with configured creds), parses login/logout lines, returns currently logged-in users. On-demand (the "Check users" button), not polled.
- `src/auth/` — single-admin JWT + bcrypt; first-run setup wizard.

### Database (`src/db/schema.ts`)
Tables auto-created on boot (`initSchema()`). Tables: `users`, `monitors`, `heartbeats`, `notifications`, `monitor_notifications` (join), `groups`, `tags`, `monitor_tags` (join). A monitor has an optional `group_id` (FK → `groups`, `ON DELETE SET NULL`) and any number of tags via `monitor_tags`. `initSchema()` also runs a lightweight in-code migration (guarded by a `PRAGMA table_info` check) to `ALTER TABLE monitors ADD COLUMN group_id` on databases that predate the groups feature — follow this pattern when adding columns to existing tables, since `CREATE TABLE IF NOT EXISTS` won't alter them. Drizzle Kit (`db:generate` / `db:push`) is available but the app self-initializes the schema.

## Commands

### Backend (`cd server`)
```bash
npm install
npm run dev      # tsx watch, http://localhost:3021
npm run build    # tsc -> dist/
npm start        # node dist/index.js
npm run db:push  # drizzle-kit (schema is also auto-created on boot)
```

### Frontend (`cd client`)
```bash
npm install
npm run dev      # vite, http://localhost:5173
npm run build    # vue-tsc -b && vite build -> client/dist
```

### Docker (whole app, single port)
```bash
docker compose up -d --build   # http://localhost:3021
```

## Configuration

Server reads `.env` from its CWD via `process.loadEnvFile` (see `src/config.ts`). Key vars:

- `PORT` (default `3021`), `CLIENT_ORIGIN` (CORS allowlist; `*` reflects any origin), `DB_PATH` (default `./data/uptime.db`).
- `JWT_SECRET` — **must be changed in production**; signs auth tokens.
- STAP log/user extraction: `STAP_LOG_ENABLED`, `STAP_LOG_UNC` (`{host}` is substituted), `STAP_LOG_USER`, `STAP_LOG_PASSWORD`.

**`server/.env` is gitignored and holds real credentials — never commit it or copy its secrets into tracked files (`.env.example`, docs, code).**

## Conventions

- ESM everywhere. Backend imports use explicit `.js` extensions (e.g. `import ... from "./config.js"`) even though sources are `.ts` — required for Node ESM. Keep this.
- No test suite or linter is configured. Verify changes by running the app.
- Comments explain *why*; keep new code's comment density and style consistent with the surrounding file.
- Notifications fire only on real up↔down transitions — preserve this when touching the scheduler.
