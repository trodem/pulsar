import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { heartbeats, monitors, type Monitor } from "../db/schema.js";
import { bus } from "../events.js";
import { notifyForMonitor } from "../notifications/index.js";
import { runCheck } from "./checkers.js";

interface Task {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastStatus: number | null; // 1 up, 2 degraded, 0 down, null unknown
}

const tasks = new Map<number, Task>();

function lastKnownStatus(monitorId: number): number | null {
  const row = db
    .select({ status: heartbeats.status })
    .from(heartbeats)
    .where(eq(heartbeats.monitorId, monitorId))
    .orderBy(desc(heartbeats.time))
    .limit(1)
    .get();
  return row ? row.status : null;
}

async function executeCheck(monitor: Monitor): Promise<void> {
  const task = tasks.get(monitor.id);
  if (!task || task.running) return;
  task.running = true;
  try {
    // Retry loop: only mark down after exhausting retries.
    let result = await runCheck(monitor);
    let attempts = 0;
    while (!result.up && attempts < monitor.retries) {
      attempts++;
      result = await runCheck(monitor);
    }

    const prev = task.lastStatus;
    // 1 = up (green), 2 = degraded (orange), 0 = down (red).
    const status = result.up ? 1 : result.degraded ? 2 : 0;
    const important = prev !== null && prev !== status;
    const time = Math.floor(Date.now() / 1000);

    const [beat] = db
      .insert(heartbeats)
      .values({
        monitorId: monitor.id,
        status,
        message: result.message,
        ping: result.ping,
        important,
        time,
      })
      .returning()
      .all();

    task.lastStatus = status;
    bus.emitEvent("heartbeat", { monitorId: monitor.id, heartbeat: beat });

    // Fire notifications only on a genuine state transition.
    if (important) {
      await notifyForMonitor({
        monitor,
        up: result.up,
        message: result.message,
        time,
      });
    }
  } catch (err) {
    console.error(`[scheduler] check failed for #${monitor.id}:`, err);
  } finally {
    task.running = false;
  }
}

function start(monitor: Monitor): void {
  stop(monitor.id);
  if (!monitor.active) return;
  const task: Task = {
    timer: null,
    running: false,
    lastStatus: lastKnownStatus(monitor.id),
  };
  tasks.set(monitor.id, task);
  // Run immediately, then on the configured interval.
  void executeCheck(monitor);
  task.timer = setInterval(
    () => void executeCheck(monitor),
    Math.max(5, monitor.interval) * 1000,
  );
}

function stop(monitorId: number): void {
  const task = tasks.get(monitorId);
  if (task?.timer) clearInterval(task.timer);
  tasks.delete(monitorId);
}

/** Restarts a single monitor's loop after create/update/toggle. */
export function reschedule(monitorId: number): void {
  const monitor = db
    .select()
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .get();
  if (monitor) start(monitor);
  else stop(monitorId);
}

export function unschedule(monitorId: number): void {
  stop(monitorId);
}

/** Loads every monitor from the DB and starts their loops. Called on boot. */
export function startScheduler(): void {
  const all = db.select().from(monitors).all();
  for (const monitor of all) start(monitor);
  console.log(`[scheduler] started ${all.length} monitor(s)`);
}
