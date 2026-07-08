import { execFile } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { monitors, type Monitor } from "../db/schema.js";
import { bus } from "../events.js";

const execFileAsync = promisify(execFile);

// Login/logout events in the log, e.g.:
//   ...I> [FrontendServer  ] Teskernel Prozess wird gestartet! User: trodem
//   ...I> [FrontendServer  ] User Logout: trodem
// A user counts as logged in when their most recent event is a login.
// Whitespace between words is flexible to tolerate formatting differences.
const LOGIN_RE = /Teskernel\s+Prozess\s+wird\s+gestartet!\s+User:\s+(\S+)/;
const LOGOUT_RE = /User\s+Logout:\s+(\S+)/;

// Per-monitor extraction state.
const usersByMonitor = new Map<number, string[]>();
// monitorId -> human-readable error while reading the log (null when healthy).
const errorByMonitor = new Map<number, string | null>();
// monitorIds currently failing to read (so we log to console only on change).
const failing = new Set<number>();
// Hosts for which an authenticated SMB session is already established.
const connectedHosts = new Set<string>();
let timer: NodeJS.Timeout | null = null;

/** Users last read from the given monitor's remote log (empty if none/unknown). */
export function getStapUsers(monitorId: number): string[] {
  return usersByMonitor.get(monitorId) ?? [];
}

/** Last error reading the monitor's log, or null if the last read succeeded. */
export function getStapError(monitorId: number): string | null {
  return errorByMonitor.get(monitorId) ?? null;
}

// Stores the latest snapshot and broadcasts it, but only when something changed.
function publish(monitorId: number, users: string[], error: string | null): void {
  const prevUsers = usersByMonitor.get(monitorId) ?? [];
  const prevError = errorByMonitor.get(monitorId) ?? null;
  if (prevError === error && sameUsers(prevUsers, users)) return;
  usersByMonitor.set(monitorId, users);
  errorByMonitor.set(monitorId, error);
  bus.emitEvent("monitor:users", { monitorId, users, error });
}

// Turns a filesystem/network error into a short message for the card.
function describeError(err: unknown, path: string): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "ENOENT":
      return "Log file not found on host";
    case "EACCES":
    case "EPERM":
      return "Access to log denied (permissions)";
    case "ETIMEDOUT":
    case "EHOSTUNREACH":
    case "EHOSTDOWN":
    case "ENETUNREACH":
    case "ENOTFOUND":
      return "Host unreachable";
    case "EBUSY":
      return "Log file is busy, retrying";
    default:
      return err instanceof Error ? err.message : `Cannot read ${path}`;
  }
}

/** Only http-ping monitors run the STAP log/user extraction. */
export function isStapMonitor(m: { type: string }): boolean {
  return m.type === "http-ping";
}

/** Extracts the hostname from a monitor target ("http://host:8080" or "host"). */
function hostFromTarget(target: string): string | null {
  try {
    return new URL(target).hostname || null;
  } catch {
    // Bare "host" or "host:port".
    const host = target.split("/")[0].split(":")[0].trim();
    return host || null;
  }
}

function logPathFor(host: string): string {
  return config.stapLogUncTemplate.replace(/\{host\}/g, host);
}

/** The folder containing the log file for a monitor's target, or null. */
export function logFolderForTarget(target: string): string | null {
  const host = hostFromTarget(target);
  if (!host) return null;
  const file = logPathFor(host);
  const idx = Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/"));
  return idx > 0 ? file.slice(0, idx) : file;
}

export interface LogFileEntry {
  name: string;
  size: number; // bytes
  modified: number; // unix seconds
}

/**
 * Lists the files in a monitor's remote log folder (newest first), using the
 * configured credentials. Throws a clean, card-ready Error on failure.
 */
export async function listLogFolder(target: string): Promise<LogFileEntry[]> {
  const host = hostFromTarget(target);
  const folder = logFolderForTarget(target);
  if (!host || !folder) throw new Error("Invalid monitor URL");
  try {
    await ensureConnection(host);
    const names = await readdir(folder);
    const files: LogFileEntry[] = [];
    for (const name of names) {
      try {
        const s = await stat(`${folder}\\${name}`);
        if (s.isFile()) {
          files.push({
            name,
            size: s.size,
            modified: Math.floor(s.mtimeMs / 1000),
          });
        }
      } catch {
        // Skip entries we can't stat (e.g. locked/inaccessible).
      }
    }
    files.sort((a, b) => b.modified - a.modified);
    return files;
  } catch (err) {
    connectedHosts.delete(host);
    throw new Error(describeError(err, folder));
  }
}

// Authenticates the SMB session to `host` with the configured credentials, so
// reads of \\host\... use them (no admin access on the server account needed).
// No-op if credentials aren't configured or the host is already connected.
// Throws a clean Error on failure so the card can show the reason.
async function ensureConnection(host: string): Promise<void> {
  if (!config.stapLogUser || !config.stapLogPassword) return;
  if (connectedHosts.has(host)) return;
  try {
    // IPC$ authenticates the whole server session; other shares reuse it.
    await execFileAsync(
      "net",
      [
        "use",
        `\\\\${host}\\IPC$`,
        `/user:${config.stapLogUser}`,
        config.stapLogPassword,
      ],
      { windowsHide: true },
    );
    connectedHosts.add(host);
  } catch (err) {
    const out = err && typeof err === "object" ? String((err as { stderr?: string; message?: string }).stderr || (err as Error).message || "") : String(err);
    // Already connected with these creds — fine, reuse the session.
    if (/multiple connections|error 1219/i.test(out)) {
      connectedHosts.add(host);
      return;
    }
    if (/error 1326|logon failure|user name or password/i.test(out)) {
      throw new Error("Invalid credentials for host");
    }
    if (/error 53|error 67|network path|network name/i.test(out)) {
      throw new Error("Host unreachable");
    }
    throw new Error("Cannot connect to host");
  }
}

// Reads only the last `maxBytes` of the file (the log rotates but can be large).
async function readTail(path: string, maxBytes: number): Promise<string> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    if (length === 0) return "";
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

// Replays the log chronologically, tracking each user's latest event. Returns
// the users whose last event was a login (i.e. currently logged in).
function extractUsers(text: string): string[] {
  const loggedIn = new Map<string, boolean>(); // preserves first-seen order
  for (const line of text.split(/\r?\n/)) {
    const login = LOGIN_RE.exec(line);
    if (login) {
      loggedIn.set(login[1], true);
      continue;
    }
    const logout = LOGOUT_RE.exec(line);
    if (logout) loggedIn.set(logout[1], false);
  }
  const users: string[] = [];
  for (const [user, isIn] of loggedIn) {
    if (isIn) users.push(user);
  }
  return users;
}

function sameUsers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function pollMonitor(m: Monitor): Promise<void> {
  const host = hostFromTarget(m.target);
  if (!host) {
    publish(m.id, [], "Invalid monitor URL");
    return;
  }
  const path = logPathFor(host);
  try {
    await ensureConnection(host);
    const text = await readTail(path, config.stapTailBytes);
    publish(m.id, extractUsers(text), null);
    if (failing.delete(m.id)) {
      console.log(`[stap] #${m.id} (${host}) log readable again`);
    }
  } catch (err) {
    // Drop the cached session so the next tick re-authenticates.
    connectedHosts.delete(host);
    // Surface the error on the card and clear any stale user list.
    const reason = describeError(err, path);
    publish(m.id, [], reason);
    if (!failing.has(m.id)) {
      failing.add(m.id);
      console.warn(`[stap] #${m.id} ${reason}: ${path}`);
    }
  }
}

function tick(): void {
  const all = db.select().from(monitors).all();
  for (const m of all) {
    if (m.active && isStapMonitor(m)) void pollMonitor(m);
  }
}

/** Starts polling remote STAP logs. No-op if disabled. */
export function startStapUsers(): void {
  if (!config.stapEnabled) {
    console.log("[stap] disabled (STAP_LOG_ENABLED=false)");
    return;
  }
  console.log(
    `[stap] reading remote logs every ${config.stapPollSeconds}s ` +
      `for http-ping monitors`,
  );
  tick();
  timer = setInterval(tick, config.stapPollSeconds * 1000);
}

/** Stops polling (for shutdown/tests). */
export function stopStapUsers(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
