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

**Deployment is native (no Docker).** In production the client is compiled (`npm run build` → `client/dist`) and copied into `server/public`; the server then serves the SPA, REST API and Socket.IO all from **one process on one port** (default `3021`) — `src/index.ts` serves `../public` via `express.static` when that dir exists. No nginx, no separate client port, no CORS. On Windows this keeps STAP working (SMB shares), which a Linux container cannot do. See `setup.md` and the `scripts/` folder: `deploy.ps1` (build + optional NSSM Windows service + firewall + `.env` bootstrap), `update.ps1` (stop → rebuild → start), `dev.sh` (dev mode: server `:3021` + Vite client `:5173`).

### Backend flow
- `src/index.ts` — boot: `initSchema()` → mount routes (`/api/auth`, `/api/monitors`, `/api/notifications`) → `initSocket()` → `startScheduler()`.
- `src/monitors/scheduler.ts` — one `setInterval` timer per active monitor. Runs `runCheck`, retries up to `monitor.retries` before marking down, writes a `heartbeats` row, emits `heartbeat` on the bus, fires notifications **only on a genuine state transition** (`important`).
- `src/monitors/checkers.ts` — `runCheck` dispatches by `monitor.type`: `http`, `tcp`, `ping`, `http-ping`. Status is `1` up (green) / `2` degraded (orange) / `0` down (red). For `http-ping`: ICMP + HTTP run in parallel; ping-down = hard down, ping-up but HTTP-fail = degraded.
- `src/events.ts` — typed in-process `EventEmitter` (`bus`) decoupling the scheduler from Socket.IO (avoids a circular import).
- `src/socket.ts` — authenticates the socket handshake with the same JWT as REST, forwards `heartbeat` and `monitor:users` events to all clients.
- `src/monitors/stap-users.ts` — **http-ping only.** Reads each host's remote log over a UNC/SMB share (`net use IPC$` with configured creds), parses login/logout lines, returns currently logged-in users. On-demand (the "Check users" button), not polled.
- `src/auth/` — JWT + bcrypt; first-run setup wizard. **Two roles** (`users.role`): `admin` (full access) and `user` (read-only). The setup wizard always creates an admin; extra accounts are seeded (`npm run seed:users`, see `src/scripts/`), there is no self-service registration endpoint. The JWT payload carries `role`. `requireAuth` populates `req.user`; `requireWrite` (mounted after it on every protected router in `index.ts`) then rejects any non-`GET`/`HEAD`/`OPTIONS` request from a non-admin with `403`. Because it keys off the HTTP method, it also gates action POSTs (e.g. `check-users`, `restart-program`) — keep read-only actions behind GET or they become admin-only. The client mirrors this (`auth` store `isAdmin`, hidden mutating controls, `adminOnly` route guard on `/settings`) but the server is the enforcement boundary.

### Database (`src/db/schema.ts`)
Tables auto-created on boot (`initSchema()`). Tables: `users`, `monitors`, `heartbeats`, `notifications`, `monitor_notifications` (join), `notification_groups` (join), `groups`, `tags`, `monitor_tags` (join). A notification targets monitors directly (`monitor_notifications`, editable from both the monitor form and the notification form) and/or whole groups (`notification_groups`); `notifyForMonitor` unions both and de-dupes by id. Channel types: `webhook`, `telegram`, `teams` (Teams sends a MessageCard to an Incoming Webhook URL). `users` has a `role` column (`admin` | `user`; see the auth notes above). A monitor has an optional `group_id` (FK → `groups`, `ON DELETE SET NULL`) and any number of tags via `monitor_tags`. `initSchema()` also runs lightweight in-code migrations (each guarded by a `PRAGMA table_info` check) that `ALTER TABLE ... ADD COLUMN` for columns added after the fact — `monitors.group_id`, and `users.role` (which also backfills pre-existing accounts to `admin`, since before roles the sole account was the admin). Follow this pattern when adding columns to existing tables, since `CREATE TABLE IF NOT EXISTS` won't alter them. Drizzle Kit (`db:generate` / `db:push`) is available but the app self-initializes the schema.

## Commands

### Backend (`cd server`)
```bash
npm install
npm run dev      # tsx watch, http://localhost:3021
npm run build    # tsc -> dist/
npm start        # node dist/index.js
npm run db:push  # drizzle-kit (schema is also auto-created on boot)
npm run seed:users  # create/update accounts (edit src/scripts/seed-users.ts)
# npx tsx src/scripts/delete-user.ts <username>  # remove an account
```

### Frontend (`cd client`)
```bash
npm install
npm run dev      # vite, http://localhost:5173
npm run build    # vue-tsc -b && vite build -> client/dist
```

### Production deploy (native Windows, from repo root)
```powershell
.\scripts\deploy.ps1                       # build client+server, copy client to server/public
.\scripts\deploy.ps1 -InstallService -OpenFirewall -ServiceUser "DOMAIN\user" -ServicePassword "..."
.\scripts\update.ps1                       # after code changes: stop -> rebuild -> start
```
Served on one port (default `3021`); reachable on the LAN at `http://<host-ip>:3021`. See `setup.md`.

## Configuration

Server reads `.env` from its CWD via `process.loadEnvFile` (see `src/config.ts`). Key vars:

- `PORT` (default `3021`), `CLIENT_ORIGIN` (CORS allowlist; `*` reflects any origin), `DB_PATH` (default `./data/uptime.db`).
- `JWT_SECRET` — **must be changed in production**; signs auth tokens.
- STAP log/user extraction: `STAP_LOG_ENABLED`, `STAP_LOG_UNC` (`{host}` is substituted), `STAP_LOG_USER`, `STAP_LOG_PASSWORD`.

**`server/.env` is gitignored and holds real credentials — never commit it or copy its secrets into tracked files (docs, code). `scripts/deploy.ps1` bootstraps a `server/.env` with a random `JWT_SECRET` if none exists.**

## Conventions

- ESM everywhere. Backend imports use explicit `.js` extensions (e.g. `import ... from "./config.js"`) even though sources are `.ts` — required for Node ESM. Keep this.
- No test suite or linter is configured. Verify changes by running the app.
- Comments explain *why*; keep new code's comment density and style consistent with the surrounding file.
- Notifications fire only on real up↔down transitions — preserve this when touching the scheduler.
