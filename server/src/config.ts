import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env if present (Node 20.12+ / 22+ has process.loadEnvFile).
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

const rawOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

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
};
