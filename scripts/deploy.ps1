<#
.SYNOPSIS
    Build e deploy nativo di Pulsar su Windows (senza Docker).

.DESCRIPTION
    Compila il client Vue, lo copia in server/public, compila il server e
    (opzionale) lo registra come servizio Windows con NSSM, apre la porta nel
    firewall e genera un server/.env se manca.

    Percorso "un solo processo, una sola porta": la UI, le API e il socket
    vengono serviti tutti dal server Node sulla porta configurata (default 3021).

.PARAMETER Port
    Porta su cui gira il server (default 3021). Usata per il firewall e mostrata
    a fine deploy. Deve corrispondere a PORT nel server/.env.

.PARAMETER InstallService
    Registra Pulsar come servizio Windows tramite NSSM (avvio automatico al boot,
    riavvio in caso di crash). Richiede nssm.exe (vedi -NssmPath).

.PARAMETER NssmPath
    Percorso di nssm.exe. Se non specificato lo cerca nel PATH.

.PARAMETER ServiceUser
    Account sotto cui gira il servizio (es. "DOMINIO\utente"). Utile per dare al
    servizio i permessi di accesso alle share C$ dei PC monitorati (funzione STAP).

.PARAMETER ServicePassword
    Password dell'account -ServiceUser.

.PARAMETER OpenFirewall
    Crea una regola firewall inbound per la porta.

.PARAMETER SkipInstall
    Salta "npm install" nei due package (usalo per ri-build veloci quando le
    dipendenze sono gia installate).

.EXAMPLE
    # Solo build (client + server), niente servizio
    .\deploy.ps1

.EXAMPLE
    # Build + servizio Windows con account per STAP + firewall aperto
    .\deploy.ps1 -InstallService -OpenFirewall -ServiceUser "AZIENDA\svc_pulsar" -ServicePassword "..."
#>

[CmdletBinding()]
param(
    [int]    $Port = 3021,
    [switch] $InstallService,
    [string] $NssmPath,
    [string] $ServiceUser,
    [string] $ServicePassword,
    [switch] $OpenFirewall,
    [switch] $SkipInstall
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Pulsar'
$root        = Split-Path $PSScriptRoot -Parent   # gli script stanno in scripts/, la root e la cartella superiore
$clientDir   = Join-Path $root 'client'
$serverDir   = Join-Path $root 'server'
$publicDir   = Join-Path $serverDir 'public'

function Write-Step  ([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    ([string]$m) { Write-Host "    $m"   -ForegroundColor Green }
function Write-Warn2 ([string]$m) { Write-Host "    $m"   -ForegroundColor Yellow }

# Esegue un comando nativo e si ferma se ritorna un exit code diverso da 0.
function Invoke-Native {
    param([string]$File, [string[]]$Args, [string]$WorkDir)
    Push-Location $WorkDir
    try {
        & $File @Args
        if ($LASTEXITCODE -ne 0) {
            throw "Comando fallito ($File $($Args -join ' ')) con exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
Write-Step "Controllo prerequisiti"
# ---------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
$npm  = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js non trovato nel PATH. Installa Node.js LTS 22 da https://nodejs.org" }
if (-not $npm)  { throw "npm non trovato nel PATH." }

$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor   = [int]($nodeVersion.Split('.')[0])
$nodeMinor   = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 12)) {
    throw "Node $nodeVersion troppo vecchio: serve >= 20.12 (consigliato 22 LTS) per process.loadEnvFile."
}
Write-Ok "Node $nodeVersion  |  npm $((& npm.cmd --version))"

# ---------------------------------------------------------------------------
Write-Step "Verifico server/.env"
# ---------------------------------------------------------------------------
$envFile = Join-Path $serverDir '.env'
if (-not (Test-Path $envFile)) {
    Write-Warn2 "server/.env mancante: ne genero uno con un JWT_SECRET casuale."
    $secret = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
    @"
PORT=$Port
JWT_SECRET=$secret
DB_PATH=./data/uptime.db

# STAP — utenti loggati / restart (solo monitor http-ping). Compila con i valori reali.
STAP_LOG_ENABLED=true
STAP_LOG_USER=
STAP_LOG_PASSWORD=
# STAP_LOG_UNC=   # lascia il default se il path e quello standard
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Ok "Creato server/.env — ricordati di compilare STAP_LOG_USER / STAP_LOG_PASSWORD."
} else {
    Write-Ok "server/.env presente (non lo tocco)."
}

# ---------------------------------------------------------------------------
Write-Step "Build del client (Vue)"
# ---------------------------------------------------------------------------
if (-not $SkipInstall) {
    Write-Ok "npm install (client)…"
    Invoke-Native 'npm.cmd' @('install') $clientDir
}
Write-Ok "npm run build (client)…"
Invoke-Native 'npm.cmd' @('run','build') $clientDir

$clientDist = Join-Path $clientDir 'dist'
if (-not (Test-Path (Join-Path $clientDist 'index.html'))) {
    throw "Build client non riuscita: $clientDist/index.html non trovato."
}

# ---------------------------------------------------------------------------
Write-Step "Copio il client in server/public"
# ---------------------------------------------------------------------------
if (Test-Path $publicDir) {
    Remove-Item -Recurse -Force $publicDir   # pulizia dei vecchi asset
}
New-Item -ItemType Directory -Force $publicDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $clientDist '*') $publicDir
Write-Ok "Client copiato in $publicDir"

# ---------------------------------------------------------------------------
Write-Step "Build del server (TypeScript)"
# ---------------------------------------------------------------------------
if (-not $SkipInstall) {
    Write-Ok "npm install (server)…"
    Invoke-Native 'npm.cmd' @('install') $serverDir
}
Write-Ok "npm run build (server)…"
Invoke-Native 'npm.cmd' @('run','build') $serverDir

$serverEntry = Join-Path $serverDir 'dist\index.js'
if (-not (Test-Path $serverEntry)) {
    throw "Build server non riuscita: $serverEntry non trovato."
}
Write-Ok "Server compilato: $serverEntry"

# ---------------------------------------------------------------------------
if ($OpenFirewall) {
    Write-Step "Apro la porta $Port nel firewall"
    $ruleName = "Pulsar ($Port)"
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
        Write-Ok "Regola firewall gia presente."
    } else {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
            -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
        Write-Ok "Regola firewall creata (TCP $Port inbound)."
    }
}

# ---------------------------------------------------------------------------
if ($InstallService) {
    Write-Step "Registro il servizio Windows '$ServiceName' (NSSM)"
    $nssm = $NssmPath
    if (-not $nssm) { $nssm = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source }
    if (-not $nssm -or -not (Test-Path $nssm)) {
        throw "nssm.exe non trovato. Scaricalo da https://nssm.cc e passa -NssmPath 'C:\percorso\nssm.exe'."
    }

    $nodeExe = (Get-Command node).Source
    $logDir  = Join-Path $serverDir 'logs'
    New-Item -ItemType Directory -Force $logDir | Out-Null

    # Se esiste gia lo fermo e riconfiguro (idempotente).
    if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
        Write-Warn2 "Servizio gia esistente: lo fermo e riconfiguro."
        & $nssm stop $ServiceName | Out-Null
    } else {
        & $nssm install $ServiceName $nodeExe 'dist\index.js'
        if ($LASTEXITCODE -ne 0) { throw "nssm install fallito ($LASTEXITCODE)." }
    }

    & $nssm set $ServiceName AppDirectory   $serverDir            | Out-Null
    & $nssm set $ServiceName AppParameters  'dist\index.js'       | Out-Null
    & $nssm set $ServiceName Start          SERVICE_AUTO_START    | Out-Null
    & $nssm set $ServiceName AppStdout      (Join-Path $logDir 'pulsar.out.log') | Out-Null
    & $nssm set $ServiceName AppStderr      (Join-Path $logDir 'pulsar.err.log') | Out-Null
    & $nssm set $ServiceName AppRotateFiles 1                     | Out-Null
    & $nssm set $ServiceName AppRotateBytes 10485760              | Out-Null  # ruota a 10 MB

    if ($ServiceUser) {
        if (-not $ServicePassword) { throw "-ServiceUser richiede anche -ServicePassword." }
        & $nssm set $ServiceName ObjectName $ServiceUser $ServicePassword | Out-Null
        Write-Ok "Servizio configurato per girare come $ServiceUser (utile per STAP)."
    }

    & $nssm start $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    $svc = Get-Service $ServiceName
    Write-Ok "Servizio '$ServiceName' stato: $($svc.Status)"
}

# ---------------------------------------------------------------------------
Write-Step "Fatto"
# ---------------------------------------------------------------------------
$ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress)
Write-Host ""
Write-Host "Pulsar e pronto sulla porta $Port." -ForegroundColor Green
if (-not $InstallService) {
    Write-Host "Avvio manuale:  cd server ; npm start" -ForegroundColor Gray
}
Write-Host "Accesso dagli altri PC della rete:" -ForegroundColor Gray
foreach ($ip in $ips) { Write-Host "    http://${ip}:$Port" -ForegroundColor White }
if (-not $OpenFirewall) {
    Write-Warn2 "Nota: non ho aperto il firewall. Rilancia con -OpenFirewall se gli altri PC non riescono a connettersi."
}
