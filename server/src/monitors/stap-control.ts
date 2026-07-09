import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import type { Monitor } from "../db/schema.js";
import { hostFromTarget } from "./stap-users.js";

const execFileAsync = promisify(execFile);

// Remotely restarts the STAP backend executable on a monitor's host. Uses CIM
// (Win32_Process) over a DCOM session through PowerShell — the same shell-out
// approach as the `net use` SMB session in stap-users, so it needs no extra
// tooling and no WinRM. CIM cmdlets (unlike the old Get-WmiObject/Invoke-Wmi-
// Method) exist in both Windows PowerShell 5.1 and PowerShell 7, and the DCOM
// session option keeps this working without WinRM enabled on the host. Any
// running instance is terminated first, then a fresh one is started; if nothing
// was running it just starts. The exe path lives in the config/.env
// (STAP_EXE_PATH), never hardcoded here. Note: the process starts in the host's
// session 0 (non-interactive), which is fine for the backend module.
const RESTART_SCRIPT = `
$ErrorActionPreference = 'Stop'
# Repair PSModulePath before touching any cmdlet from a module: when the server
# is launched as a Windows service / by a process manager, the inherited
# environment can have an empty PSModulePath, which makes module autoload fail
# with "CouldNotAutoloadMatchingModule" for Get-CimInstance & co. $PSHOME is set
# by the engine regardless, and $PSHOME\\Modules holds CimCmdlets.
if (($env:PSModulePath -split ';') -notcontains "$PSHOME\\Modules") {
  $env:PSModulePath = "$PSHOME\\Modules;$env:PSModulePath"
}
Import-Module CimCmdlets -ErrorAction Stop
$exe = $env:PS_EXE
$name = Split-Path $exe -Leaf
$opt = New-CimSessionOption -Protocol Dcom
$params = @{ ComputerName = $env:PS_HOST; SessionOption = $opt }
if ($env:PS_USER) {
  $sec = ConvertTo-SecureString $env:PS_PASS -AsPlainText -Force
  $params.Credential = New-Object System.Management.Automation.PSCredential($env:PS_USER, $sec)
}
$session = New-CimSession @params
try {
  $procs = @(Get-CimInstance -CimSession $session -ClassName Win32_Process -Filter "Name='$name'")
  foreach ($p in $procs) { [void](Invoke-CimMethod -CimSession $session -InputObject $p -MethodName Terminate) }
  if ($procs.Count -gt 0) { Start-Sleep -Milliseconds 700 }
  $res = Invoke-CimMethod -CimSession $session -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $exe }
  if ($res.ReturnValue -ne 0) {
    $map = @{ '2' = 'Access denied'; '3' = 'Insufficient privilege'; '8' = 'Unknown failure'; '9' = ('Executable not found: ' + $exe); '21' = 'Invalid parameter' }
    $why = $map["$($res.ReturnValue)"]
    if (-not $why) { $why = "code $($res.ReturnValue)" }
    throw "Start failed: $why"
  }
  Write-Output ("stopped=" + $procs.Count + " started_pid=" + $res.ProcessId)
} finally {
  Remove-CimSession $session
}
`;

// Turns a CIM/PowerShell failure into a short, card-ready message.
function describeError(out: string): string {
  if (
    /rpc server is unavailable|0x800706ba|cannot connect|winrm cannot complete|not be found|unreachable/i.test(
      out,
    )
  ) {
    return "Host unreachable";
  }
  if (/logon failure|user name or password|0x8007052e|1326/i.test(out)) {
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
