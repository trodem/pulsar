<#
.SYNOPSIS
    Aktualisiert Pulsar (natives Windows-Deployment) nach einer Codeänderung.

.DESCRIPTION
    Stoppt den Dienst (falls vorhanden), baut Client + Server über deploy.ps1 neu und
    startet den Dienst wieder. Nach einem "git pull" oder lokalen Änderungen verwenden.

    - Wenn Pulsar als Windows-Dienst läuft: stop -> rebuild -> start.
    - Wenn es im manuellen Start läuft: nur rebuild, danach daran denken,
      "cd server ; npm start" erneut auszuführen.

.PARAMETER Full
    Führt auch "npm install" aus (verwenden, wenn sich die Abhängigkeiten geändert haben,
    also package.json). Ohne dieses Flag überspringt der Rebuild den Install und ist schneller.

.EXAMPLE
    .\update.ps1
    # schneller Rebuild und Dienst-Neustart

.EXAMPLE
    .\update.ps1 -Full
    # nach einem Update, das die Abhängigkeiten berührt hat
#>

[CmdletBinding()]
param(
    [switch] $Full
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Pulsar'
$deploy      = Join-Path $PSScriptRoot 'deploy.ps1'   # neben update.ps1, in scripts/

if (-not (Test-Path $deploy)) { throw "deploy.ps1 nicht neben update.ps1 gefunden." }

$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue

if ($svc) {
    Write-Host "==> Stoppe den Dienst '$ServiceName'…" -ForegroundColor Cyan
    Stop-Service $ServiceName
    (Get-Service $ServiceName).WaitForStatus('Stopped', '00:00:30')
    Write-Host "    Dienst gestoppt." -ForegroundColor Green
} else {
    Write-Host "==> Kein Dienst '$ServiceName' installiert: führe nur den Rebuild aus." -ForegroundColor Yellow
}

# Rebuild (überspringt npm install, außer bei -Full).
if ($Full) {
    & $deploy
} else {
    & $deploy -SkipInstall
}
if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    throw "deploy.ps1 hat einen Fehler zurückgegeben ($LASTEXITCODE)."
}

if ($svc) {
    Write-Host "==> Starte den Dienst '$ServiceName' neu…" -ForegroundColor Cyan
    Start-Service $ServiceName
    (Get-Service $ServiceName).WaitForStatus('Running', '00:00:30')
    Write-Host "    Dienst läuft." -ForegroundColor Green
} else {
    Write-Host "==> Rebuild abgeschlossen. Manueller Start: cd server ; npm start" -ForegroundColor Gray
}
