import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import type { Monitor } from "../db/schema.js";
import { hostFromTarget } from "./stap-users.js";

const execFileAsync = promisify(execFile);

// Remotely restarts the STAP backend executable on a monitor's host over WinRM
// (WS-Management) via PowerShell remoting (Invoke-Command). This replaces the
// former DCOM CimSession: remote DCOM activation went through the COM Surrogate
// (dllhost.exe) and was flagged/blocked as lateral movement by EDR tools such as
// Cortex XDR. WinRM uses a distinct, admin-standard transport (wsmprovhost) that
// EDRs treat far less aggressively. Requires WinRM enabled on the host
// (Enable-PSRemoting) and, outside a domain, the host listed in the client's
// TrustedHosts. Any running instance is terminated first, then a fresh one is
// started; if nothing was running it just starts. The exe path lives in the
// config/.env (STAP_EXE_PATH), never hardcoded here. The process is (re)started
// with a *local* Win32_Process.Create inside the remote session so it detaches
// from the WinRM session and keeps running in session 0 (non-interactive) — a
// plain Start-Process would die as a child of wsmprovhost when the session ends.
const RESTART_SCRIPT = `
$ErrorActionPreference = 'Stop'
# Repair PSModulePath before Invoke-Command touches any module-backed cmdlet:
# when the server is launched as a Windows service / by a process manager, the
# inherited environment can have an empty PSModulePath, which makes module
# autoload fail with "CouldNotAutoloadMatchingModule". $PSHOME is set by the
# engine regardless, and $PSHOME\\Modules holds the core modules.
if (($env:PSModulePath -split ';') -notcontains "$PSHOME\\Modules") {
  $env:PSModulePath = "$PSHOME\\Modules;$env:PSModulePath"
}
$exe = $env:PS_EXE
$name = [System.IO.Path]::GetFileNameWithoutExtension($exe)
# Only pass explicit credentials when configured; otherwise the service account's
# integrated auth (Kerberos) is used.
$params = @{ ComputerName = $env:PS_HOST; ErrorAction = 'Stop' }
if ($env:PS_USER) {
  $sec = ConvertTo-SecureString $env:PS_PASS -AsPlainText -Force
  $params.Credential = New-Object System.Management.Automation.PSCredential($env:PS_USER, $sec)
}
$out = Invoke-Command @params -ArgumentList $exe, $name -ScriptBlock {
  param($exe, $name)
  $ErrorActionPreference = 'Stop'
  $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
  foreach ($p in $procs) { Stop-Process -Id $p.Id -Force }
  if ($procs.Count -gt 0) { Start-Sleep -Milliseconds 700 }
  if (-not (Test-Path -LiteralPath $exe)) { throw "Executable not found: $exe" }
  # Local WMI create (no DCOM/CimSession) so the process detaches from this
  # WinRM session and survives its teardown in session 0.
  $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $exe }
  if ($res.ReturnValue -ne 0) {
    $map = @{ '2' = 'Access denied'; '3' = 'Insufficient privilege'; '8' = 'Unknown failure'; '9' = ('Executable not found: ' + $exe); '21' = 'Invalid parameter' }
    $why = $map["$($res.ReturnValue)"]
    if (-not $why) { $why = "code $($res.ReturnValue)" }
    throw "Start failed: $why"
  }
  "stopped=" + $procs.Count + " started_pid=" + $res.ProcessId
}
Write-Output $out
`;

// Turns a WinRM/PowerShell failure into a short, card-ready message.
function describeError(out: string): string {
  // TrustedHosts / transport config: WinRM refuses the connection because the
  // target isn't in TrustedHosts or HTTPS/Kerberos isn't used.
  if (/trustedhosts|https transport must be used/i.test(out)) {
    return "WinRM: host not in TrustedHosts (use HTTPS/Kerberos)";
  }
  // WinRM unreachable / not enabled: service not running, firewall blocking, or
  // the computer name can't be resolved.
  if (
    /winrm cannot (complete|process)|cannot find the computer|connecting to remote server|firewall exception for the winrm|rpc server is unavailable|0x800706ba|cannot connect|not be found|unreachable/i.test(
      out,
    )
  ) {
    return "Host unreachable or WinRM not enabled";
  }
  if (
    /logon failure|user name or password|username or password|0x8007052e|1326|0x8009030e/i.test(
      out,
    )
  ) {
    return "Invalid credentials for host";
  }
  if (/access is denied|0x80070005|access denied/i.test(out)) {
    return "Access to host denied (permissions)";
  }
  if (/executable not found/i.test(out)) {
    return "Executable not found on host";
  }
  if (/couldnotautoloadmatchingmodule|autoload/i.test(out)) {
    return "PowerShell module load failed on the server (PSModulePath)";
  }
  // Prefer the first meaningful PowerShell line (the actual message), skipping
  // location/marker/FullyQualifiedErrorId noise which carries no useful text.
  const line = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .find(
      (s) =>
        !/^(\+|At |In |PS |CategoryInfo|FullyQualifiedErrorId|PSComputerName|~+$)/i.test(
          s,
        ),
    );
  return line || "Could not restart the program";
}

/**
 * Stops any running STAP executable on the monitor's host and starts a fresh
 * one (a plain start if nothing was running). Returns a short status string on
 * success. Throws a clean, card-ready Error on failure.
 */
export async function restartStapProgram(m: Monitor): Promise<string> {
  const host = hostFromTarget(m.target);
  if (!host) throw new Error("Invalid monitor URL");
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", RESTART_SCRIPT],
      {
        windowsHide: true,
        // Params go through the environment, never string-interpolated into the
        // script, so a path/credential can't break out of the command.
        env: {
          ...process.env,
          PS_HOST: host,
          PS_EXE: config.stapExePath,
          PS_USER: config.stapLogUser,
          PS_PASS: config.stapLogPassword,
        },
      },
    );
    return stdout.trim() || "Restarted";
  } catch (err) {
    const out =
      err && typeof err === "object"
        ? String(
            (err as { stderr?: string; message?: string }).stderr ||
              (err as Error).message ||
              "",
          )
        : String(err);
    throw new Error(describeError(out));
  }
}
