import net from "node:net";
import ping from "ping";
import type { Monitor } from "../db/schema.js";

export interface CheckResult {
  up: boolean;
  ping: number | null; // milliseconds
  message: string;
  // Partial failure: the service is reachable but not fully healthy
  // (e.g. http-ping where ICMP answers but the HTTP check fails).
  // Rendered as a distinct "degraded" (orange) state.
  degraded?: boolean;
}

/**
 * Parses an accepted-status spec like "200-299,301,400-403" into a predicate.
 */
function statusMatcher(spec: string): (code: number) => boolean {
  const ranges = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [lo, hi] = part.split("-").map((n) => Number(n));
      return { lo, hi: Number.isFinite(hi) ? hi : lo };
    });
  return (code) => ranges.some((r) => code >= r.lo && code <= r.hi);
}

async function checkHttp(monitor: Monitor): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout * 1000);
  const start = performance.now();
  try {
    const res = await fetch(monitor.target, {
      method: monitor.method || "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    const elapsed = performance.now() - start;
    const matches = statusMatcher(monitor.acceptedStatus)(res.status);
    return {
      up: matches,
      ping: Math.round(elapsed),
      message: matches
        ? `${res.status} ${res.statusText}`.trim()
        : `Unexpected status ${res.status}`,
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Timeout after ${monitor.timeout}s`
        : err instanceof Error
          ? err.message
          : "Request failed";
    return { up: false, ping: null, message };
  } finally {
    clearTimeout(timer);
  }
}

function checkTcp(monitor: Monitor): Promise<CheckResult> {
  return new Promise((resolvePromise) => {
    if (!monitor.port) {
      resolvePromise({ up: false, ping: null, message: "No port configured" });
      return;
    }
    const start = performance.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(monitor.timeout * 1000);
    socket.once("connect", () => {
      done({
        up: true,
        ping: Math.round(performance.now() - start),
        message: `Connected to ${monitor.target}:${monitor.port}`,
      });
    });
    socket.once("timeout", () =>
      done({ up: false, ping: null, message: `Timeout after ${monitor.timeout}s` }),
    );
    socket.once("error", (err) =>
      done({ up: false, ping: null, message: err.message }),
    );
    socket.connect(monitor.port, monitor.target);
  });
}

interface PingResult {
  alive: boolean;
  time: number | null;
  message: string;
}

/** Runs an ICMP ping against a host and normalizes the result. */
async function probePing(host: string, timeout: number): Promise<PingResult> {
  try {
    const res = await ping.promise.probe(host, { timeout, min_reply: 1 });
    if (res.alive) {
      const time = res.time === "unknown" ? null : Number(res.time);
      return {
        alive: true,
        time,
        message: `Host is alive${time != null ? ` (${time} ms)` : ""}`,
      };
    }
    return { alive: false, time: null, message: "Host unreachable" };
  } catch (err) {
    return {
      alive: false,
      time: null,
      message: err instanceof Error ? err.message : "Ping failed",
    };
  }
}

async function checkPing(monitor: Monitor): Promise<CheckResult> {
  const res = await probePing(monitor.target, monitor.timeout);
  return { up: res.alive, ping: res.time, message: res.message };
}

/**
 * Combined check: the host must answer ICMP ping AND the HTTP request must
 * return an accepted status. Both run in parallel; the monitor is up only if
 * both pass. Reports the HTTP response time as ping and includes the ICMP
 * round-trip in the message.
 */
async function checkHttpPing(monitor: Monitor): Promise<CheckResult> {
  let host: string;
  try {
    host = new URL(monitor.target).hostname;
  } catch {
    return { up: false, ping: null, message: `Invalid URL: ${monitor.target}` };
  }

  const [http, pingRes] = await Promise.all([
    checkHttp(monitor),
    probePing(host, monitor.timeout),
  ]);

  const pingPart = pingRes.alive
    ? `ping ${pingRes.time != null ? `${pingRes.time} ms` : "ok"}`
    : "ping failed";
  const message = `HTTP: ${http.message} · ${pingPart}`;

  // Ping down always wins as a hard failure (red). If the host answers ICMP
  // but the HTTP check fails, the service is degraded (orange), not fully down.
  if (!pingRes.alive) {
    return { up: false, degraded: false, ping: http.ping, message };
  }
  if (!http.up) {
    return { up: false, degraded: true, ping: http.ping, message };
  }
  return { up: true, ping: http.ping, message };
}

export async function runCheck(monitor: Monitor): Promise<CheckResult> {
  switch (monitor.type) {
    case "http":
      return checkHttp(monitor);
    case "tcp":
      return checkTcp(monitor);
    case "ping":
      return checkPing(monitor);
    case "http-ping":
      return checkHttpPing(monitor);
    default:
      return { up: false, ping: null, message: `Unknown type: ${monitor.type}` };
  }
}
