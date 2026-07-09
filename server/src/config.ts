import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env if present (Node 20.12+ / 22+ has process.loadEnvFile).
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

const rawOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

// STAP logged-user extraction. Each monitored machine writes its console output
// to a rotating log file; log_backend_0.log is the current one. We read it over
// the network (UNC admin share) using the host from the monitor's target URL,
// parse the "... User: <name>" lines, and show the users on that monitor's card.
// {host} is substituted with the monitor's hostname at read time.
const DEFAULT_STAP_LOG_UNC =
  "\\\\{host}\\C$\\Users\\stibs\\AppData\\Roaming\\stibs\\portable\\base\\module\\logging\\log_backend_0.log";

// Local path (on the remote host) of the STAP backend executable that the
// "Restart" card button stops and starts again via WMI. Overridable in .env.
const DEFAULT_STAP_EXE_PATH =
  "C:\\Users\\stibs\\AppData\\Roaming\\stibs\\portable\\base\\module\\backend\\STAP_Stibs2.exe";

export const config = {
  port: Number(process.env.PORT || 3021),
  // "*" reflects any origin (single-origin self-hosted / Docker deploy);
  // otherwise a comma-separated allowlist.
  clientOrigin: (
    rawOrigin === "*"
      ? true
      : rawOrigin.split(",").map((s) => s.trim())
  ) as true | string[],
  jwtSecret: process.env.JWT_SECRET || "dev-insecure-secret-change-me",
  dbPath: process.env.DB_PATH || "./data/uptime.db",

  // STAP logged-user extraction (only for http-ping monitors).
  stapLogUncTemplate: process.env.STAP_LOG_UNC || DEFAULT_STAP_LOG_UNC,
  // Remote path of the STAP backend exe controlled by the card "Restart" button.
  stapExePath: process.env.STAP_EXE_PATH || DEFAULT_STAP_EXE_PATH,
  // Optional Windows credentials to authenticate the SMB session to each host
  // (avoids needing the server's own account to have access). Both must be set.
  // User may be "DOMAIN\\user", "user@domain" or a plain username.
  stapLogUser: process.env.STAP_LOG_USER || "",
  stapLogPassword: process.env.STAP_LOG_PASSWORD || "",
  // Force on/off with STAP_LOG_ENABLED=true|false; default on.
  stapEnabled: process.env.STAP_LOG_ENABLED
    ? process.env.STAP_LOG_ENABLED === "true"
    : true,
};
