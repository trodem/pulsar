import net from "node:net";
import ping from "ping";
import type { Monitor } from "../db/schema.js";

export interface CheckResult {
  up: boolean;
  ping: number | null; // milliseconds
  message: string;
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

async function checkPing(monitor: Monitor): Promise<CheckResult> {
  try {
    const res = await ping.promise.probe(monitor.target, {
      timeout: monitor.timeout,
      min_reply: 1,
    });
    if (res.alive) {
      const time = res.time === "unknown" ? null : Number(res.time);
      return {
        up: true,
        ping: time,
        message: `Host is alive${time != null ? ` (${time} ms)` : ""}`,
      };
    }
    return { up: false, ping: null, message: "Host unreachable" };
  } catch (err) {
    return {
      up: false,
      ping: null,
      message: err instanceof Error ? err.message : "Ping failed",
    };
  }
}

export async function runCheck(monitor: Monitor): Promise<CheckResult> {
  switch (monitor.type) {
    case "http":
      return checkHttp(monitor);
    case "tcp":
      return checkTcp(monitor);
    case "ping":
      return checkPing(monitor);
    default:
      return { up: false, ping: null, message: `Unknown type: ${monitor.type}` };
  }
}
