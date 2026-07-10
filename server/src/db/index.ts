import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema.js";

const dbPath = resolve(process.env.DB_PATH || "./data/uptime.db");

// Ensure the parent directory exists before opening the file.
const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/**
 * Creates all tables if they don't exist yet. Kept idempotent so the app can
 * boot with a fresh SQLite file without a separate migration step.
 */
export function initSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'http',
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      target TEXT NOT NULL,
      port INTEGER,
      interval INTEGER NOT NULL DEFAULT 60,
      timeout INTEGER NOT NULL DEFAULT 10,
      retries INTEGER NOT NULL DEFAULT 0,
      accepted_status TEXT NOT NULL DEFAULT '200-299',
      method TEXT NOT NULL DEFAULT 'GET',
      active INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      status INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      ping REAL,
      important INTEGER NOT NULL DEFAULT 0,
      time INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time
      ON heartbeats (monitor_id, time);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS monitor_notifications (
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_notifications
      ON monitor_notifications (monitor_id, notification_id);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#4f9dff',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS monitor_tags (
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_tags
      ON monitor_tags (monitor_id, tag_id);

    CREATE TABLE IF NOT EXISTS maintenances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      strategy TEXT NOT NULL DEFAULT 'single',
      active INTEGER NOT NULL DEFAULT 1,
      start_date INTEGER,
      end_date INTEGER,
      start_time INTEGER,
      end_time INTEGER,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      days_of_month TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS maintenance_monitors (
      maintenance_id INTEGER NOT NULL REFERENCES maintenances(id) ON DELETE CASCADE,
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_monitors
      ON maintenance_monitors (maintenance_id, monitor_id);

    CREATE TABLE IF NOT EXISTS maintenance_groups (
      maintenance_id INTEGER NOT NULL REFERENCES maintenances(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_groups
      ON maintenance_groups (maintenance_id, group_id);
  `);

  // Migrate pre-existing databases whose monitors table predates the groups
  // feature: add the group_id column if it's missing (CREATE TABLE IF NOT
  // EXISTS above is a no-op once the table exists).
  if (!columnExists("monitors", "group_id")) {
    sqlite.exec(
      "ALTER TABLE monitors ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;",
    );
  }

  // Migrate databases that predate drag-and-drop reordering: add the position
  // column (defaults to 0, so existing monitors keep their id order until moved).
  if (!columnExists("monitors", "position")) {
    sqlite.exec(
      "ALTER TABLE monitors ADD COLUMN position INTEGER NOT NULL DEFAULT 0;",
    );
  }
}

/** True if `table` already has a column named `column`. */
function columnExists(table: string, column: string): boolean {
  const cols = sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

export { sqlite };
