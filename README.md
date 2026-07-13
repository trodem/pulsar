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

## Production deploy (native Windows, no Docker)

In production Pulsar runs as **one process on one port** (default `3021`): the
client is built and copied into `server/public`, and the server serves the SPA,
REST API and Socket.IO from there — no nginx, no separate port, no CORS. Native
deploy is required for **STAP** (reading each host's logged-in users via Windows
SMB shares), which cannot work inside a Linux container.

From the repo root, in an **Administrator** PowerShell:

```powershell
.\scripts\deploy.ps1        # build client + server, copy client to server/public
cd server ; npm start       # or install as a service (below)
```

Full deploy with an auto-starting Windows service (NSSM), firewall rule, and a
service account with access to the monitored hosts' `C$` shares (for STAP):

```powershell
.\scripts\deploy.ps1 -InstallService -OpenFirewall `
    -NssmPath "C:\Tools\nssm.exe" `
    -ServiceUser "DOMAIN\user" -ServicePassword "..."
```

Then open `http://<host-ip>:3021` from any PC on the LAN and create the admin
account on first run. After code changes, redeploy with `.\scripts\update.ps1`
(stop → rebuild → start). See **[setup.md](setup.md)** for the full guide.

## Notes

- Ping uses the system `ping` binary (via the `ping` package), so it works
  without elevated privileges on Windows/Linux/macOS.
- Notifications fire only on a genuine state transition (up→down / down→up),
  matching Uptime Kuma's behaviour.
