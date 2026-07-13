<#
.SYNOPSIS
    Aggiorna Pulsar (deploy nativo Windows) dopo una modifica al codice.

.DESCRIPTION
    Ferma il servizio (se presente), ricompila client + server tramite deploy.ps1
    e riavvia il servizio. Da usare dopo un "git pull" o modifiche locali.

    - Se Pulsar gira come servizio Windows: stop -> rebuild -> start.
    - Se gira in avvio manuale: solo rebuild, poi ricordati di rilanciare
      "cd server ; npm start".

.PARAMETER Full
    Esegue anche "npm install" (usalo quando sono cambiate le dipendenze, cioe
    package.json). Senza questo flag il rebuild salta l'install ed e piu veloce.

.EXAMPLE
    .\update.ps1
    # rebuild veloce e riavvio servizio

.EXAMPLE
    .\update.ps1 -Full
    # dopo un aggiornamento che ha toccato le dipendenze
#>

[CmdletBinding()]
param(
    [switch] $Full
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Pulsar'
$deploy      = Join-Path $PSScriptRoot 'deploy.ps1'   # accanto a update.ps1, in scripts/

if (-not (Test-Path $deploy)) { throw "deploy.ps1 non trovato accanto a update.ps1." }

$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue

if ($svc) {
    Write-Host "==> Fermo il servizio '$ServiceName'…" -ForegroundColor Cyan
    Stop-Service $ServiceName
    (Get-Service $ServiceName).WaitForStatus('Stopped', '00:00:30')
    Write-Host "    Servizio fermato." -ForegroundColor Green
} else {
    Write-Host "==> Nessun servizio '$ServiceName' installato: eseguo solo il rebuild." -ForegroundColor Yellow
}

# Rebuild (salta npm install a meno che -Full).
if ($Full) {
    & $deploy
} else {
    & $deploy -SkipInstall
}
if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    throw "deploy.ps1 ha restituito un errore ($LASTEXITCODE)."
}

if ($svc) {
    Write-Host "==> Riavvio il servizio '$ServiceName'…" -ForegroundColor Cyan
    Start-Service $ServiceName
    (Get-Service $ServiceName).WaitForStatus('Running', '00:00:30')
    Write-Host "    Servizio in esecuzione." -ForegroundColor Green
} else {
    Write-Host "==> Rebuild completato. Avvio manuale: cd server ; npm start" -ForegroundColor Gray
}
