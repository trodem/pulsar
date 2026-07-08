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
  // How often to re-read the remote log (seconds).
  stapPollSeconds: Number(process.env.STAP_POLL_SECONDS || 15),
  // Only read the last N bytes of the log, to bound work and bias to recent
  // activity (the file rotates but can still be large).
  stapTailBytes: Number(process.env.STAP_TAIL_BYTES || 65536),
  // Force on/off with STAP_LOG_ENABLED=true|false; default on.
  stapEnabled: process.env.STAP_LOG_ENABLED
    ? process.env.STAP_LOG_ENABLED === "true"
    : true,
};
