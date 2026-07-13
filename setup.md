# Setup Pulsar — installazione nativa su Windows (senza Docker)

Guida per installare Pulsar su un PC Windows e renderlo raggiungibile da tutti i
PC della stessa rete locale. Questa modalità **nativa** (niente Docker) mantiene
attive **tutte** le funzionalità, inclusa la lettura degli utenti loggati e il
restart via STAP (che usa le share SMB di Windows e non funziona in container Linux).

Architettura in produzione: **un solo processo, una sola porta**. Il server Node
serve la UI, le API e il socket sulla porta `3021`; il client Vue viene compilato
e copiato in `server/public`. Niente nginx, niente CORS, niente porte separate.

---

## 1. Prerequisiti

- **Windows 10/11** (o Windows Server).
- **Node.js LTS 22** — https://nodejs.org (serve ≥ 20.12 per `process.loadEnvFile`).
- **NSSM** (solo se vuoi il servizio Windows) — https://nssm.cc, scarica ed estrai
  `nssm.exe` da qualche parte (es. `C:\Tools\nssm.exe`).
- Una copia del progetto sul PC host (puoi escludere le cartelle `node_modules`,
  vengono reinstallate dallo script).

---

## 2. Deploy automatico (consigliato)

Tutti i passaggi sono automatizzati da **`scripts\deploy.ps1`**. Apri **PowerShell
come Amministratore** nella cartella del progetto.

### Prova rapida (solo build, avvio manuale)

```powershell
.\scripts\deploy.ps1
cd server ; npm start
```

Lo script, se `server/.env` non esiste, ne crea uno con un `JWT_SECRET` casuale.

### Deploy completo (servizio Windows + firewall + STAP)

```powershell
.\scripts\deploy.ps1 -InstallService -OpenFirewall `
    -NssmPath "C:\Tools\nssm.exe" `
    -ServiceUser "DOMINIO\utente" -ServicePassword "la-password"
```

Cosa fa lo script, in ordine:

1. Verifica Node ≥ 20.12.
2. Crea `server/.env` con `JWT_SECRET` casuale **se manca** (se c'è, non lo tocca).
3. `npm install` + `npm run build` del **client**.
4. Copia il client compilato in **`server/public`** (pulendo i vecchi file).
5. `npm install` + `npm run build` del **server**.
6. *(con `-OpenFirewall`)* apre la porta TCP nel firewall.
7. *(con `-InstallService`)* registra/riconfigura il servizio Windows `Pulsar`,
   avvio automatico, log su `server/logs/` con rotazione a 10 MB, e — se indicato
   — lo fa girare sotto l'account `-ServiceUser`.
8. Mostra gli URL di accesso dagli altri PC.

### Parametri utili

| Parametro | Effetto |
|---|---|
| `-Port 3021` | Porta del server (default 3021; deve combaciare con `PORT` in `.env`). |
| `-InstallService` | Registra il servizio Windows via NSSM. |
| `-NssmPath <path>` | Percorso di `nssm.exe` se non è nel PATH. |
| `-ServiceUser` / `-ServicePassword` | Account sotto cui gira il servizio (chiave per STAP). |
| `-OpenFirewall` | Crea la regola firewall inbound per la porta. |
| `-SkipInstall` | Salta `npm install` (rebuild veloce se le dipendenze ci sono già). |

---

## 3. Configurazione `server/.env`

Se lo generi a mano, i valori chiave sono:

```ini
PORT=3021
JWT_SECRET=<stringa-lunga-e-casuale>
DB_PATH=./data/uptime.db

# STAP — utenti loggati / restart (solo monitor http-ping)
STAP_LOG_ENABLED=true
STAP_LOG_USER=DOMINIO\utente
STAP_LOG_PASSWORD=<password>
# STAP_LOG_UNC=   # lascia il default se il path è quello standard
```

Genera un buon `JWT_SECRET`:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

> ⚠️ Se cambi `JWT_SECRET` in seguito, tutti gli utenti dovranno rifare il login.
>
> ⚠️ `server/.env` contiene credenziali reali: **non committarlo mai** (è già gitignorato).

### Requisiti STAP

Perché la funzione "Check users" / restart funzioni, l'account con cui gira il
server (l'utente `-ServiceUser`, oppure `STAP_LOG_USER`/`STAP_LOG_PASSWORD`) deve
avere accesso alle share amministrative `C$` dei PC monitorati.

---

## 4. Firewall

Se non hai usato `-OpenFirewall`, apri la porta a mano (PowerShell admin):

```powershell
New-NetFirewallRule -DisplayName "Pulsar (3021)" -Direction Inbound `
    -Protocol TCP -LocalPort 3021 -Action Allow
```

---

## 5. Accesso dagli altri PC

1. Sul PC host trova l'IP della rete locale:

   ```powershell
   ipconfig   # cerca "IPv4 Address", es. 192.168.1.50
   ```

2. Dagli altri PC apri il browser su:

   ```
   http://192.168.1.50:3021
   ```

3. Il **primo accesso** avvia la procedura guidata per creare l'account admin.

> 💡 Assegna al PC host un **IP fisso** (statico o reservation sul router),
> altrimenti l'indirizzo può cambiare e gli altri PC perderebbero l'accesso.
> In alternativa usa il nome host: `http://nome-pc:3021`.

---

## 6. Gestione del servizio

```powershell
Start-Service   Pulsar
Stop-Service    Pulsar
Restart-Service Pulsar
Get-Service     Pulsar
```

Log del servizio: `server/logs/pulsar.out.log` e `server/logs/pulsar.err.log`.

Vantaggi del servizio Windows: si avvia al boot **senza login**, riparte da solo
in caso di crash, gira senza terminale aperto e sotto un account con i permessi
giusti per STAP.

---

## 7. Aggiornare Pulsar

Dopo un `git pull` o modifiche al codice, usa **`update.ps1`** (PowerShell admin):

```powershell
.\scripts\update.ps1          # ferma servizio -> rebuild veloce -> riavvia
.\scripts\update.ps1 -Full    # come sopra ma con "npm install" (se sono cambiate le dipendenze)
```

Se Pulsar è in avvio manuale (senza servizio), `update.ps1` fa solo il rebuild:
poi rilancia `cd server ; npm start`.

---

## 8. Backup

Tutti i dati stanno in un unico file SQLite:

```
server/data/uptime.db
```

Per il backup, ferma il servizio (o copia a caldo) e archivia quel file.
Ripristino: rimetti il file e riavvia.

---

## 9. Sviluppo (per riferimento)

Per lavorare sul codice, non in produzione, c'è `scripts/dev.sh` (Git Bash): avvia server
(`:3021`) e client (`:5173`) in modalità dev con ricaricamento automatico. In
questa modalità la UI passa dal dev server Vite, **non** da `server/public`.

---

## Nota su Docker

Il repository contiene anche un setup Docker (`docker-compose.yml`, `Dockerfile`,
`nginx.conf`). Per la modalità nativa **non serve** e puoi ignorarlo: se non lanci
`docker compose`, quei file sono inerti. La modalità nativa è preferibile qui
perché STAP (SMB Windows) non funziona nel container Linux.
