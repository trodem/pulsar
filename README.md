# Pulsar

Ein selbst gehosteter Uptime-Monitor, inspiriert von
[Uptime Kuma](https://github.com/louislam/uptime-kuma), gebaut mit einem
Express-+-TypeScript-Backend, einem Vue-3-Frontend und einer SQLite-Datenbank.

## Funktionen

- Monitor-Typen: **HTTP(s)**, **TCP-Port**, **Ping**
- **Gruppen** (Dashboard-Bereiche) und farbige **Tags** mit Tag-basierter Filterung
- Pro Monitor: Intervall, Timeout, Wiederholungen und akzeptierte Statuscodes
- Live-Dashboard über **WebSocket** (Socket.IO): Heartbeat-Balken, 24h-Uptime-%, Latenz
- Verlauf / Ereignisprotokoll der Up⇄Down-Übergänge
- **Benachrichtigungen** bei Statuswechsel: Webhook, Telegram und Microsoft Teams
  (mit Test-Schaltfläche), jeweils auf einzelne Monitore und/oder ganze Gruppen ausrichtbar
- **Authentifizierung** (JWT + bcrypt), Einrichtungsassistent beim ersten Start
- Zero-Config-**SQLite**-Speicher (Tabellen werden beim Start automatisch angelegt)

## Technologie-Stack

| Schicht    | Technologie                                                 |
| ---------- | ----------------------------------------------------------- |
| Backend    | Node.js, Express, TypeScript, Socket.IO                     |
| Datenbank  | SQLite über libSQL (`@libsql/client`) + Drizzle ORM         |
| Scheduler  | In-Process-Timer pro Monitor                                |
| Frontend   | Vue 3, Vite, Pinia, Vue Router, `socket.io-client`, TS      |

## Projektstruktur

```
server/   Express-API, Checker, Scheduler, Socket.IO, SQLite
client/   Vue-3-SPA (Dashboard, Monitor-Editor, Benachrichtigungen)
```

## Erste Schritte

### 1. Backend

```bash
cd server
npm install
cp .env.example .env        # optional: JWT_SECRET / PORT ändern
npm run dev                 # http://localhost:3021
```

Die SQLite-Datei wird automatisch unter `server/data/uptime.db` angelegt.

### 2. Frontend

```bash
cd client
npm install
npm run dev                 # http://localhost:5173
npm run dev --nousers       # wie oben, blendet aber die „Online users"-Buttons aus
```

Vite leitet `/api` und `/socket.io` an das Backend weiter, öffne also einfach
http://localhost:5173 und lege beim ersten Start dein Admin-Konto an.

Mit dem Flag `--nousers` werden im gesamten Frontend die **„Online users"**-Buttons
(Remote-Log auslesen, nur `http-ping`-Monitore) ausgeblendet. Das Flag wirkt zur
Build-Zeit und gilt daher auch für den Produktions-Build: `npm run build --nousers`.
Es blendet nur die Bedienelemente aus; der Server-Endpunkt bleibt erreichbar. Die
Skripte reichen es weiter: `dev.sh --nousers` sowie `deploy.ps1 -NoUsers` und
`update.ps1 -NoUsers` (Standard: Buttons sichtbar).

## Produktions-Deployment (nativ unter Windows, ohne Docker)

In Produktion läuft Pulsar als **ein Prozess auf einem Port** (Standard `3021`):
Der Client wird gebaut und nach `server/public` kopiert, und der Server liefert
von dort die SPA, die REST-API und Socket.IO — kein nginx, kein getrennter Port,
kein CORS. Das native Deployment ist für **STAP** erforderlich (Auslesen der
angemeldeten Benutzer jedes Hosts über Windows-SMB-Freigaben), was in einem
Linux-Container nicht funktioniert.

Im Projekt-Stammverzeichnis, in einer **Administrator**-PowerShell:

```powershell
.\scripts\deploy.ps1        # Client + Server bauen, Client nach server/public kopieren
cd server ; npm start       # oder als Dienst installieren (siehe unten)
```

Vollständiges Deployment mit automatisch startendem Windows-Dienst (NSSM),
Firewall-Regel und einem Dienstkonto mit Zugriff auf die `C$`-Freigaben der
überwachten Hosts (für STAP):

```powershell
.\scripts\deploy.ps1 -InstallService -OpenFirewall `
    -NssmPath "C:\Tools\nssm.exe" `
    -ServiceUser "DOMAIN\benutzer" -ServicePassword "..."
```

Öffne dann `http://<host-ip>:3021` von einem beliebigen PC im LAN und lege beim
ersten Start das Admin-Konto an. Nach Codeänderungen mit `.\scripts\update.ps1`
neu ausrollen (stoppen → neu bauen → starten). Zum Stoppen und Freigeben des Ports
`.\scripts\stop.ps1` (mit `-CloseFirewall` auch die Firewall-Regel entfernen). Siehe
**[setup.md](setup.md)** für die vollständige Anleitung.

## Hinweise

- Ping nutzt die System-`ping`-Binärdatei (über das `ping`-Paket), funktioniert
  also ohne erhöhte Rechte unter Windows/Linux/macOS.
- Benachrichtigungen werden nur bei einem echten Statuswechsel ausgelöst
  (up→down / down→up), entsprechend dem Verhalten von Uptime Kuma.
