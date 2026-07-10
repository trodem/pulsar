import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  maintenanceGroups,
  maintenanceMonitors,
  maintenances,
  monitors,
  type Maintenance,
} from "../db/schema.js";

// Parses a JSON array of integers stored in a text column, tolerating garbage.
function parseNums(json: string): number[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

// True if `minutes` (0..1439) falls in the daily window [start, end). When
// end <= start the window wraps past midnight (e.g. 22:00 -> 02:00).
function timeInWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false; // zero-length window matches nothing
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // wraps midnight
}

// The calendar day a recurring window instance "belongs to". For a window that
// wraps past midnight, the post-midnight tail belongs to the previous day, so
// weekly/monthly day matching uses that day rather than the literal now.
function anchorDay(now: Date, start: number, end: number): Date {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start > end && minutes < end) {
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    return prev;
  }
  return now;
}

// Whether a maintenance window is active at `now` (server-local time).
function isActiveNow(m: Maintenance, now: Date): boolean {
  const nowSec = Math.floor(now.getTime() / 1000);

  if (m.strategy === "single") {
    return (
      m.startDate != null &&
      m.endDate != null &&
      nowSec >= m.startDate &&
      nowSec <= m.endDate
    );
  }

  // Recurring strategies: honor the optional validity range, then the daily
  // time-of-day window, then any weekday / day-of-month constraint.
  if (m.startDate != null && nowSec < m.startDate) return false;
  if (m.endDate != null && nowSec > m.endDate) return false;
  if (m.startTime == null || m.endTime == null) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  if (!timeInWindow(minutes, m.startTime, m.endTime)) return false;

  if (m.strategy === "daily") return true;

  const anchor = anchorDay(now, m.startTime, m.endTime);
  if (m.strategy === "weekly") {
    return parseNums(m.daysOfWeek).includes(anchor.getDay());
  }
  if (m.strategy === "monthly") {
    return parseNums(m.daysOfMonth).includes(anchor.getDate());
  }
  return false;
}

/**
 * Computes the set of monitor ids currently covered by an active maintenance
 * window — either linked directly or via one of the monitor's groups. Queried
 * live from the DB (the fleet is small); called on each scheduler maintenance
 * tick and whenever the maintenance config changes.
 */
export async function monitorIdsUnderMaintenance(
  now = new Date(),
): Promise<Set<number>> {
  const active = await db
    .select()
    .from(maintenances)
    .where(eq(maintenances.active, true))
    .all();

  const result = new Set<number>();
  for (const m of active) {
    if (!isActiveNow(m, now)) continue;

    const directMonitors = await db
      .select({ id: maintenanceMonitors.monitorId })
      .from(maintenanceMonitors)
      .where(eq(maintenanceMonitors.maintenanceId, m.id))
      .all();
    for (const r of directMonitors) {
      result.add(r.id);
    }

    const groupIds = (
      await db
        .select({ id: maintenanceGroups.groupId })
        .from(maintenanceGroups)
        .where(eq(maintenanceGroups.maintenanceId, m.id))
        .all()
    ).map((r) => r.id);
    if (groupIds.length > 0) {
      const groupMonitors = await db
        .select({ id: monitors.id })
        .from(monitors)
        .where(inArray(monitors.groupId, groupIds))
        .all();
      for (const r of groupMonitors) {
        result.add(r.id);
      }
    }
  }
  return result;
}
