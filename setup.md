# Pulsar Setup — native Installation unter Windows (ohne Docker)

Anleitung, um Pulsar auf einem Windows-PC zu installieren und für alle PCs im
selben lokalen Netzwerk erreichbar zu machen. Dieser **native** Modus (ohne
Docker) hält **alle** Funktionen aktiv, einschließlich des Auslesens der
angemeldeten Benutzer und des Neustarts über STAP (das die SMB-Freigaben von
Windows nutzt und in einem Linux-Container nicht funktioniert).

Architektur in Produktion: **ein einziger Prozess, ein einziger Port**. Der
Node-Server liefert die UI, die APIs und den Socket auf Port `3021`; der
Vue-Client wird kompiliert und nach `server/public` kopiert. Kein nginx, kein
CORS, keine getrennten Ports.

---

## 1. Voraussetzungen

- **Windows 10/11** (oder Windows Server).
- **Node.js LTS 22** — https://nodejs.org (benötigt ≥ 20.12 für `process.loadEnvFile`).
- **NSSM** (nur wenn du den Windows-Dienst willst) — https://nssm.cc, lade herunter
  und entpacke `nssm.exe` irgendwohin (z. B. `C:\Tools\nssm.exe`).
- Eine Kopie des Projekts auf dem Host-PC (die Ordner `node_modules` kannst du
  weglassen, sie werden vom Skript neu installiert).

---

## 2. Automatisches Deployment (empfohlen)

Alle Schritte sind durch **`scripts\deploy.ps1`** automatisiert. Öffne
**PowerShell als Administrator** im Projektordner.

### Schnelltest (Build + Start in einem Befehl)

```powershell
.\scripts\deploy.ps1 -Start -OpenFirewall
```

Kompiliert und startet den Server sofort im Vordergrund (Strg+C zum Beenden).
Ohne `-Start` führt das Skript nur den Build aus, und du musst manuell starten
(`cd server ; npm start`). Existiert `server/.env` nicht, erzeugt das Skript eine
Datei mit einem zufälligen `JWT_SECRET`.

### Vollständiges Deployment (Windows-Dienst + Firewall + STAP)

```powershell
.\scripts\deploy.ps1 -InstallService -OpenFirewall `
    -NssmPath "C:\Tools\nssm.exe" `
    -ServiceUser "DOMAIN\benutzer" -ServicePassword "das-passwort"
```

Was das Skript der Reihe nach macht:

1. Prüft Node ≥ 20.12.
2. Erstellt `server/.env` mit zufälligem `JWT_SECRET`, **falls sie fehlt** (ist
   sie vorhanden, bleibt sie unberührt).
3. `npm install` + `npm run build` des **Clients**.
4. Kopiert den kompilierten Client nach **`server/public`** (löscht dabei die
   alten Dateien).
5. `npm install` + `npm run build` des **Servers**.
6. *(mit `-OpenFirewall`)* öffnet den TCP-Port in der Firewall.
7. *(mit `-InstallService`)* registriert/konfiguriert den Windows-Dienst `Pulsar`,
   Autostart, Logs unter `server/logs/` mit Rotation bei 10 MB, und — falls
   angegeben — lässt ihn unter dem Konto `-ServiceUser` laufen.
8. Zeigt die Zugriffs-URLs für die anderen PCs an.

### Nützliche Parameter

| Parameter | Wirkung |
|---|---|
| `-Port 3021` | Port des Servers (Standard 3021; muss mit `PORT` in `.env` übereinstimmen). |
| `-InstallService` | Registriert den Windows-Dienst über NSSM. |
| `-NssmPath <pfad>` | Pfad zu `nssm.exe`, falls nicht im PATH. |
| `-ServiceUser` / `-ServicePassword` | Konto, unter dem der Dienst läuft (entscheidend für STAP). |
| `-OpenFirewall` | Erstellt die eingehende Firewall-Regel für den Port. |
| `-Start` | Startet den Server nach dem Build im Vordergrund (Strg+C zum Beenden). Wird mit `-InstallService` ignoriert. |
| `-SkipInstall` | Überspringt `npm install` (schneller Rebuild, wenn die Abhängigkeiten schon da sind). |

---

## 3. Konfiguration `server/.env`

Wenn du sie manuell erstellst, sind die wichtigsten Werte:

```ini
PORT=3021
JWT_SECRET=<lange-zufällige-zeichenkette>
DB_PATH=./data/uptime.db

# STAP — angemeldete Benutzer / Neustart (nur http-ping-Monitore)
STAP_LOG_ENABLED=true
STAP_LOG_USER=DOMAIN\benutzer
STAP_LOG_PASSWORD=<passwort>
# STAP_LOG_UNC=   # Standard belassen, wenn der Pfad der übliche ist
```

Ein gutes `JWT_SECRET` erzeugen:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

> ⚠️ Wenn du `JWT_SECRET` später änderst, müssen sich alle Benutzer neu anmelden.
>
> ⚠️ `server/.env` enthält echte Zugangsdaten: **niemals committen** (ist bereits in `.gitignore`).

### STAP-Voraussetzungen

Damit die Funktion „Benutzer prüfen" / Neustart funktioniert, muss das Konto,
unter dem der Server läuft (der Benutzer `-ServiceUser` oder
`STAP_LOG_USER`/`STAP_LOG_PASSWORD`), Zugriff auf die administrativen
`C$`-Freigaben der überwachten PCs haben.

---

## 4. Firewall

Wenn du `-OpenFirewall` nicht verwendet hast, öffne den Port manuell (PowerShell
als Admin):

```powershell
New-NetFirewallRule -DisplayName "Pulsar (3021)" -Direction Inbound `
    -Protocol TCP -LocalPort 3021 -Action Allow
```

---

## 5. Zugriff von den anderen PCs

1. Ermittle auf dem Host-PC die IP-Adresse im lokalen Netzwerk:

   ```powershell
   ipconfig   # suche "IPv4-Adresse", z. B. 192.168.1.50
   ```

2. Öffne auf den anderen PCs den Browser unter:

   ```
   http://192.168.1.50:3021
   ```

3. Der **erste Zugriff** startet den Assistenten zum Anlegen des Admin-Kontos.

> 💡 Gib dem Host-PC eine **feste IP** (statisch oder Reservierung am Router),
> sonst kann sich die Adresse ändern und die anderen PCs verlieren den Zugriff.
> Alternativ verwende den Hostnamen: `http://pc-name:3021`.

---

## 6. Verwaltung des Dienstes

```powershell
Start-Service   Pulsar
Stop-Service    Pulsar
Restart-Service Pulsar
Get-Service     Pulsar
```

Dienst-Logs: `server/logs/pulsar.out.log` und `server/logs/pulsar.err.log`.

Vorteile des Windows-Dienstes: startet beim Booten **ohne Anmeldung**, startet bei
einem Absturz von selbst neu, läuft ohne offenes Terminal und unter einem Konto
mit den richtigen Rechten für STAP.

---

## 7. Pulsar aktualisieren

Nach einem `git pull` oder Codeänderungen verwende **`update.ps1`** (PowerShell
als Admin):

```powershell
.\scripts\update.ps1          # Dienst stoppen -> schneller Rebuild -> neu starten
.\scripts\update.ps1 -Full    # wie oben, aber mit "npm install" (wenn sich Abhängigkeiten geändert haben)
```

Läuft Pulsar im manuellen Modus (ohne Dienst), macht `update.ps1` nur den
Rebuild: danach `cd server ; npm start` erneut ausführen.

---

## 8. Backup

Alle Daten liegen in einer einzigen SQLite-Datei:

```
server/data/uptime.db
```

Für das Backup den Dienst stoppen (oder heiß kopieren) und diese Datei sichern.
Wiederherstellung: die Datei zurückspielen und neu starten.

---

## 9. Entwicklung (zur Referenz)

Zum Arbeiten am Code, nicht für die Produktion, gibt es `scripts/dev.sh` (Git
Bash): startet Server (`:3021`) und Client (`:5173`) im Dev-Modus mit
automatischem Neuladen. In diesem Modus kommt die UI vom Vite-Dev-Server,
**nicht** aus `server/public`.

---

## Hinweis zu Docker

Das Docker-Setup wurde aus dem Repository **entfernt**. Das Deployment erfolgt
ausschließlich nativ (diese Anleitung), weil STAP die SMB-Freigaben von Windows
nutzt und in einem Linux-Container nicht funktioniert.
