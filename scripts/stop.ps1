<#
.SYNOPSIS
    Stoppt Pulsar und gibt den Port frei (Gegenstück zu deploy.ps1).

.DESCRIPTION
    Beendet den laufenden Pulsar-Server und macht den Port wieder frei:

    - Läuft Pulsar als Windows-Dienst (per NSSM installiert), wird der Dienst gestoppt.
    - Läuft er im Vordergrund (deploy.ps1 -Start) oder anderweitig, wird der Node-Prozess
      beendet, der auf dem Port lauscht.

    Mit -CloseFirewall wird zusätzlich die eingehende Firewallregel entfernt, die
    deploy.ps1 -OpenFirewall angelegt hat ("Port schließen"). Fehlen die
    Administratorrechte, wird dieser Schritt über eine elevierte Instanz ausgeführt
    (UAC-Abfrage) — genau wie in deploy.ps1.

.PARAMETER Port
    Port, den Pulsar belegt (Standard 3021). Muss mit PORT in server/.env übereinstimmen.

.PARAMETER CloseFirewall
    Entfernt die Firewallregel "Pulsar (<Port>)" (schließt den Port nach außen).

.EXAMPLE
    # Server stoppen, Port für lokale Prozesse freigeben (Firewallregel bleibt)
    .\stop.ps1

.EXAMPLE
    # Server stoppen UND die Firewallregel entfernen (Port komplett schließen)
    .\stop.ps1 -CloseFirewall
#>

[CmdletBinding()]
param(
    [int]    $Port = 3021,
    [switch] $CloseFirewall
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Pulsar'

function Write-Step  ([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    ([string]$m) { Write-Host "    $m"   -ForegroundColor Green }
function Write-Warn2 ([string]$m) { Write-Host "    $m"   -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
Write-Step "Stoppe Pulsar"
# ---------------------------------------------------------------------------
$stopped = $false

# 1) Als Windows-Dienst (NSSM)? Dann sauber über den Dienst stoppen.
$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne 'Stopped') {
        Stop-Service $ServiceName
        (Get-Service $ServiceName).WaitForStatus('Stopped', '00:00:30')
        Write-Ok "Dienst '$ServiceName' gestoppt."
    } else {
        Write-Ok "Dienst '$ServiceName' war bereits gestoppt."
    }
    $stopped = $true
}

# 2) Prozess, der auf dem Port lauscht, beenden (Vordergrundstart oder Restprozess).
#    Deckt auch den Fall ab, dass der Dienst gestoppt ist, aber noch ein node übrig blieb.
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { 'unbekannt' }
        Stop-Process -Id $procId -Force
        Write-Ok "Prozess $procId ($name) auf Port $Port beendet."
        $stopped = $true
    }
} elseif (-not $svc) {
    Write-Warn2 "Kein Prozess lauscht auf Port $Port — Pulsar läuft offenbar nicht."
}

if ($stopped) {
    # Kurz warten, bis das Betriebssystem den Socket wirklich freigibt.
    Start-Sleep -Milliseconds 500
}

# Prüfen, ob der Port jetzt frei ist.
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Warn2 "Achtung: Port $Port ist weiterhin belegt."
} else {
    Write-Ok "Port $Port ist frei."
}

# ---------------------------------------------------------------------------
if ($CloseFirewall) {
    Write-Step "Entferne die Firewallregel für Port $Port"
    $ruleName = "Pulsar ($Port)"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        Write-Ok "Keine Firewallregel '$ruleName' vorhanden (nichts zu tun)."
    } else {
        # Remove-NetFirewallRule benötigt Administratorrechte. Wie in deploy.ps1 wird ohne
        # erhöhte Rechte eine elevierte Instanz gestartet (UAC-Abfrage bestätigen).
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
        $fwCmd = "Remove-NetFirewallRule -DisplayName '$ruleName' -ErrorAction Stop"
        if ($isAdmin) {
            Remove-NetFirewallRule -DisplayName $ruleName
        } else {
            Write-Warn2 "Keine Administratorrechte: die Firewallregel wird über eine elevierte Instanz entfernt (UAC-Abfrage bestätigen)."
            $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru `
                -ArgumentList '-NoProfile', '-Command', $fwCmd
            if ($p.ExitCode -ne 0) {
                throw "Firewallregel konnte nicht entfernt werden (elevierter Prozess Exit-Code $($p.ExitCode)). Starte das Skript als Administrator."
            }
        }
        # Erst nach echter Prüfung Erfolg melden (CIM-Cmdlets umgehen teils ErrorActionPreference).
        if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
            throw "Firewallregel '$ruleName' konnte nicht entfernt werden."
        }
        Write-Ok "Firewallregel '$ruleName' entfernt (Port nach außen geschlossen)."
    }
}

# ---------------------------------------------------------------------------
Write-Step "Fertig"
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Pulsar gestoppt." -ForegroundColor Green
if (-not $CloseFirewall) {
    Write-Host "Hinweis: Die Firewallregel bleibt bestehen. Zum Schließen des Ports erneut mit -CloseFirewall starten." -ForegroundColor Gray
}
