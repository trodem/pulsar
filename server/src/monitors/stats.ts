import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { heartbeats, type Heartbeat } from "../db/schema.js";

export function recentHeartbeats(monitorId: number, limit = 50): Heartbeat[] {
  const rows = db
    .select()
    .from(heartbeats)
    .where(eq(heartbeats.monitorId, monitorId))
    .orderBy(desc(heartbeats.time))
    .limit(limit)
    .all();
  // Return chronological (oldest -> newest) for easy bar rendering.
  return rows.reverse();
}

export interface MonitorStats {
  status: number | null; // latest status
  lastMessage: string;
  lastCheck: number | null;
  uptime24h: number | null; // 0..1
  avgPing: number | null; // ms
}

export function monitorStats(monitorId: number): MonitorStats {
  const latest = db
    .select()
    .from(heartbeats)
    .where(eq(heartbeats.monitorId, monitorId))
    .orderBy(desc(heartbeats.time))
    .limit(1)
    .get();

  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const window = db
    .select({ status: heartbeats.status, ping: heartbeats.ping })
    .from(heartbeats)
    .where(
      and(eq(heartbeats.monitorId, monitorId), gte(heartbeats.time, since)),
    )
    .all();

  let up = 0;
  let pingSum = 0;
  let pingCount = 0;
  for (const b of window) {
    if (b.status === 1) up++;
    if (b.ping != null) {
      pingSum += b.ping;
      pingCount++;
    }
  }

  return {
    status: latest ? latest.status : null,
    lastMessage: latest ? latest.message : "",
    lastCheck: latest ? latest.time : null,
    uptime24h: window.length ? up / window.length : null,
    avgPing: pingCount ? Math.round(pingSum / pingCount) : null,
  };
}
