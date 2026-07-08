@echo off
title STIBS 8080
cd "C:\Users\STIBS\AppData\Roaming\stibs\portable\base\module\backend"

powershell -NoProfile -Command "$logPath = 'C:\Users\STIBS\Desktop\' + $env:COMPUTERNAME + '_logs.txt'; New-Item -Path $logPath -ItemType File -Force | Out-Null; .\STAP_Stibs2.exe 2>&1 | ForEach-Object { Write-Host $_; if ($_ -match 'Prozess wird gestartet! User:\s*(.+)') { $timestamp = Get-Date -Format 'dd.MM.yyyy HH:mm:ss'; $pcName = $env:COMPUTERNAME; $user = $matches[1].Trim(); $msg = $timestamp + ' - PC: ' + $pcName + ' - LOGIN: ' + $user; Add-Content -Path $logPath -Value $msg } elseif ($_ -match 'user logout[:\s]+(.+)') { $timestamp = Get-Date -Format 'dd.MM.yyyy HH:mm:ss'; $pcName = $env:COMPUTERNAME; $user = $matches[1].Trim(); $msg = $timestamp + ' - PC: ' + $pcName + ' - LOGOUT: ' + $user; Add-Content -Path $logPath -Value $msg } }"

pause