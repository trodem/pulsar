<#
.SYNOPSIS
    Build und natives Deployment von Pulsar unter Windows (ohne Docker).

.DESCRIPTION
    Kompiliert den Vue-Client, kopiert ihn nach server/public, kompiliert den Server
    und registriert ihn (optional) als Windows-Dienst mit NSSM, öffnet den Port in der
    Firewall und erzeugt eine server/.env, falls sie fehlt.

    Ansatz "ein Prozess, ein Port": UI, API und Socket werden alle vom Node-Server
    auf dem konfigurierten Port ausgeliefert (Standard 3021).

.PARAMETER Port
    Port, auf dem der Server läuft (Standard 3021). Wird für die Firewall verwendet und
    am Ende des Deployments angezeigt. Muss mit PORT in server/.env übereinstimmen.

.PARAMETER InstallService
    Registriert Pulsar als Windows-Dienst über NSSM (automatischer Start beim Booten,
    Neustart bei Absturz). Benötigt nssm.exe (siehe -NssmPath).

.PARAMETER NssmPath
    Pfad zu nssm.exe. Ohne Angabe wird im PATH gesucht.

.PARAMETER ServiceUser
    Konto, unter dem der Dienst läuft (z. B. "DOMAENE\benutzer"). Nützlich, um dem Dienst
    die Zugriffsrechte auf die C$-Freigaben der überwachten PCs zu geben (STAP-Funktion).

.PARAMETER ServicePassword
    Passwort des Kontos -ServiceUser.

.PARAMETER OpenFirewall
    Erstellt eine eingehende Firewallregel für den Port.

.PARAMETER SkipInstall
    Überspringt "npm install" in beiden Paketen (für schnelle Re-Builds, wenn die
    Abhängigkeiten bereits installiert sind).

.PARAMETER Start
    Startet nach dem Build den Server direkt im Vordergrund (node dist/index.js), ohne
    einen Dienst zu installieren. Praktisch, um alles mit einem einzigen Befehl zu
    erledigen, wenn du NSSM nicht willst (oder nicht hast). Ctrl+C zum Beenden. Wird mit
    -InstallService ignoriert (in dem Fall startet der Dienst von selbst).

.PARAMETER NoUsers
    Baut den Client mit ausgeblendeten "Online users"-Buttons (Remote-Log auslesen,
    nur http-ping-Monitore). Reicht das Flag --nousers an "npm run build" durch.

.EXAMPLE
    # Build + sofortiger Start im Vordergrund (ein einziger Befehl, kein Dienst)
    .\deploy.ps1 -Start -OpenFirewall

.EXAMPLE
    # Nur Build (Client + Server), kein Start
    .\deploy.ps1

.EXAMPLE
    # Build + Windows-Dienst mit Konto für STAP + geöffnete Firewall
    .\deploy.ps1 -InstallService -OpenFirewall -ServiceUser "FIRMA\svc_pulsar" -ServicePassword "..."
#>

[CmdletBinding()]
param(
    [int]    $Port = 3021,
    [switch] $InstallService,
    [string] $NssmPath,
    [string] $ServiceUser,
    [string] $ServicePassword,
    [switch] $OpenFirewall,
    [switch] $SkipInstall,
    [switch] $Start,
    [switch] $NoUsers
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Pulsar'
$root        = Split-Path $PSScriptRoot -Parent   # die Skripte liegen in scripts/, die Root ist der übergeordnete Ordner
$clientDir   = Join-Path $root 'client'
$serverDir   = Join-Path $root 'server'
$publicDir   = Join-Path $serverDir 'public'

function Write-Step  ([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    ([string]$m) { Write-Host "    $m"   -ForegroundColor Green }
function Write-Warn2 ([string]$m) { Write-Host "    $m"   -ForegroundColor Yellow }

# Führt einen nativen Befehl aus und bricht ab, wenn der Exit-Code ungleich 0 ist.
function Invoke-Native {
    # $Arguments statt $Args: $Args ist eine automatische PowerShell-Variable — als
    # Parametername würde der Splat "@Args" die (leere) Automatik-Variable verwenden und
    # das eigentliche Argument (z. B. "install") ginge verloren.
    param([string]$File, [string[]]$Arguments, [string]$WorkDir)
    Push-Location $WorkDir
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Befehl fehlgeschlagen ($File $($Arguments -join ' ')) mit Exit-Code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
Write-Step "Prüfe Voraussetzungen"
# ---------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
$npm  = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js nicht im PATH gefunden. Installiere Node.js LTS 22 von https://nodejs.org" }
if (-not $npm)  { throw "npm nicht im PATH gefunden." }

$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor   = [int]($nodeVersion.Split('.')[0])
$nodeMinor   = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 12)) {
    throw "Node $nodeVersion zu alt: benötigt >= 20.12 (empfohlen 22 LTS) für process.loadEnvFile."
}
Write-Ok "Node $nodeVersion  |  npm $((& npm.cmd --version))"

# ---------------------------------------------------------------------------
Write-Step "Prüfe server/.env"
# ---------------------------------------------------------------------------
$envFile = Join-Path $serverDir '.env'
if (-not (Test-Path $envFile)) {
    Write-Warn2 "server/.env fehlt: erzeuge eine mit einem zufälligen JWT_SECRET."
    $secret = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
    @"
PORT=$Port
JWT_SECRET=$secret
DB_PATH=./data/uptime.db

# STAP — eingeloggte Benutzer / Neustart (nur http-ping-Monitore). Mit den echten Werten ausfüllen.
STAP_LOG_ENABLED=true
STAP_LOG_USER=
STAP_LOG_PASSWORD=
# STAP_LOG_UNC=   # Standard lassen, wenn der Pfad der Standardpfad ist
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Ok "server/.env erstellt — denke daran, STAP_LOG_USER / STAP_LOG_PASSWORD auszufüllen."
} else {
    Write-Ok "server/.env vorhanden (bleibt unberührt)."
}

# ---------------------------------------------------------------------------
Write-Step "Build des Clients (Vue)"
# ---------------------------------------------------------------------------
if (-not $SkipInstall) {
    Write-Ok "npm install (client)…"
    Invoke-Native 'npm.cmd' @('install') $clientDir
}
# Bei -NoUsers die "Online users"-Buttons ausblenden. Statt eines npm-Flags
# (das npm künftig verwirft) setzen wir die Umgebungsvariable PULSAR_NO_USERS,
# die der Client-Build in client/vite.config.ts ausliest.
if ($NoUsers) {
    Write-Ok "npm run build (client, ohne 'Online users'-Buttons)…"
    $env:PULSAR_NO_USERS = '1'
    try     { Invoke-Native 'npm.cmd' @('run','build') $clientDir }
    finally { Remove-Item Env:\PULSAR_NO_USERS -ErrorAction SilentlyContinue }
} else {
    Write-Ok "npm run build (client)…"
    Invoke-Native 'npm.cmd' @('run','build') $clientDir
}

$clientDist = Join-Path $clientDir 'dist'
if (-not (Test-Path (Join-Path $clientDist 'index.html'))) {
    throw "Client-Build fehlgeschlagen: $clientDist/index.html nicht gefunden."
}

# ---------------------------------------------------------------------------
Write-Step "Kopiere den Client nach server/public"
# ---------------------------------------------------------------------------
if (Test-Path $publicDir) {
    Remove-Item -Recurse -Force $publicDir   # Aufräumen der alten Assets
}
New-Item -ItemType Directory -Force $publicDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $clientDist '*') $publicDir
Write-Ok "Client kopiert nach $publicDir"

# ---------------------------------------------------------------------------
Write-Step "Build des Servers (TypeScript)"
# ---------------------------------------------------------------------------
if (-not $SkipInstall) {
    Write-Ok "npm install (server)…"
    Invoke-Native 'npm.cmd' @('install') $serverDir
}
Write-Ok "npm run build (server)…"
Invoke-Native 'npm.cmd' @('run','build') $serverDir

$serverEntry = Join-Path $serverDir 'dist\index.js'
if (-not (Test-Path $serverEntry)) {
    throw "Server-Build fehlgeschlagen: $serverEntry nicht gefunden."
}
Write-Ok "Server kompiliert: $serverEntry"

# ---------------------------------------------------------------------------
if ($OpenFirewall) {
    Write-Step "Öffne Port $Port in der Firewall"
    $ruleName = "Pulsar ($Port)"
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
        Write-Ok "Firewallregel bereits vorhanden."
    } else {
        # New-NetFirewallRule benötigt Administratorrechte. Läuft das Skript nicht erhöht,
        # erzeugen wir die Regel über eine eigene elevierte Instanz (UAC-Abfrage), statt
        # mit "Zugriff verweigert" zu scheitern.
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
        $fwCmd = "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null"
        if ($isAdmin) {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
                -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
        } else {
            Write-Warn2 "Keine Administratorrechte: die Firewallregel wird über eine elevierte Instanz erstellt (UAC-Abfrage bestätigen)."
            $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru `
                -ArgumentList '-NoProfile', '-Command', $fwCmd
            if ($p.ExitCode -ne 0) {
                throw "Firewallregel konnte nicht erstellt werden (elevierter Prozess Exit-Code $($p.ExitCode)). Starte das Skript als Administrator."
            }
        }
        # Erst nach echter Prüfung Erfolg melden — CIM-Cmdlets liefern Fehler, die
        # $ErrorActionPreference='Stop' nicht immer abfangen, sonst würde ein Fehlschlag
        # fälschlich als Erfolg ausgegeben.
        if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
            Write-Ok "Firewallregel erstellt (TCP $Port eingehend)."
        } else {
            throw "Firewallregel wurde nicht erstellt (Port $Port)."
        }
    }
}

# ---------------------------------------------------------------------------
if ($InstallService) {
    Write-Step "Registriere den Windows-Dienst '$ServiceName' (NSSM)"
    $nssm = $NssmPath
    if (-not $nssm) {
        # Kein ?.-Operator: der ist erst ab PowerShell 7 verfügbar, dieses Skript läuft auch unter Windows PowerShell 5.1.
        $nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
        if ($nssmCmd) { $nssm = $nssmCmd.Source }
    }
    if (-not $nssm -or -not (Test-Path $nssm)) {
        throw "nssm.exe nicht gefunden. Lade es von https://nssm.cc und übergib -NssmPath 'C:\pfad\nssm.exe'."
    }

    $nodeExe = (Get-Command node).Source
    $logDir  = Join-Path $serverDir 'logs'
    New-Item -ItemType Directory -Force $logDir | Out-Null

    # Falls bereits vorhanden, stoppen und neu konfigurieren (idempotent).
    if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
        Write-Warn2 "Dienst bereits vorhanden: wird gestoppt und neu konfiguriert."
        & $nssm stop $ServiceName | Out-Null
    } else {
        & $nssm install $ServiceName $nodeExe 'dist\index.js'
        if ($LASTEXITCODE -ne 0) { throw "nssm install fehlgeschlagen ($LASTEXITCODE)." }
    }

    & $nssm set $ServiceName AppDirectory   $serverDir            | Out-Null
    & $nssm set $ServiceName AppParameters  'dist\index.js'       | Out-Null
    & $nssm set $ServiceName Start          SERVICE_AUTO_START    | Out-Null
    & $nssm set $ServiceName AppStdout      (Join-Path $logDir 'pulsar.out.log') | Out-Null
    & $nssm set $ServiceName AppStderr      (Join-Path $logDir 'pulsar.err.log') | Out-Null
    & $nssm set $ServiceName AppRotateFiles 1                     | Out-Null
    & $nssm set $ServiceName AppRotateBytes 10485760              | Out-Null  # rotiert bei 10 MB

    if ($ServiceUser) {
        if (-not $ServicePassword) { throw "-ServiceUser benötigt auch -ServicePassword." }
        & $nssm set $ServiceName ObjectName $ServiceUser $ServicePassword | Out-Null
        Write-Ok "Dienst konfiguriert, um als $ServiceUser zu laufen (nützlich für STAP)."
    }

    & $nssm start $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    $svc = Get-Service $ServiceName
    Write-Ok "Dienst '$ServiceName' Status: $($svc.Status)"
}

# ---------------------------------------------------------------------------
Write-Step "Fertig"
# ---------------------------------------------------------------------------
$ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress)
Write-Host ""
Write-Host "Pulsar ist bereit auf Port $Port." -ForegroundColor Green
if (-not $InstallService) {
    Write-Host "Manueller Start:  cd server ; npm start" -ForegroundColor Gray
}
Write-Host "Zugriff von anderen PCs im Netzwerk:" -ForegroundColor Gray
foreach ($ip in $ips) { Write-Host "    http://${ip}:$Port" -ForegroundColor White }
if (-not $OpenFirewall) {
    Write-Warn2 "Hinweis: Firewall wurde nicht geöffnet. Starte erneut mit -OpenFirewall, falls andere PCs sich nicht verbinden können."
}

# Start im Vordergrund auf Wunsch (nur wenn kein Dienst installiert wird).
if ($Start -and -not $InstallService) {
    Write-Step "Starte den Server (Ctrl+C zum Beenden)"
    # node dist/index.js mit CWD = server, damit server/.env und server/data gelesen werden.
    Invoke-Native (Get-Command node).Source @('dist\index.js') $serverDir
}
