import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { heartbeats, monitors, type Monitor } from "../db/schema.js";
import { bus } from "../events.js";
import { notifyForMonitor } from "../notifications/index.js";
import { runCheck } from "./checkers.js";
import { monitorIdsUnderMaintenance } from "./maintenance.js";

interface Task {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastStatus: number | null; // 1 up, 2 degraded, 0 down, 3 maintenance, null unknown
}

const tasks = new Map<number, Task>();

// How often we re-evaluate which monitors are under maintenance, so windows
// start/end promptly regardless of each monitor's own check interval.
const MAINTENANCE_TICK_MS = 30_000;

// Monitor ids currently under an active maintenance window. Kept in sync by the
// maintenance tick; read by executeCheck to skip (suspend) checks.
let underMaintenance = new Set<number>();
let maintenanceTimer: NodeJS.Timeout | null = null;

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
  // Suspend checks while the monitor is under maintenance: the maintenance tick
  // owns the status=3 heartbeat, and we produce no other beats or notifications.
  if (underMaintenance.has(monitor.id)) return;
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
    // A transition out of maintenance (prev === 3) resumes checks but must not
    // fire a notification, so it never counts as important.
    const important = prev !== null && prev !== 3 && prev !== status;
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

// Writes the single status=3 heartbeat that marks a monitor entering a
// maintenance window (important=false, so no notification), and broadcasts it.
function writeMaintenanceBeat(monitorId: number, task: Task): void {
  const time = Math.floor(Date.now() / 1000);
  const [beat] = db
    .insert(heartbeats)
    .values({
      monitorId,
      status: 3,
      message: "Under maintenance",
      ping: null,
      important: false,
      time,
    })
    .returning()
    .all();
  task.lastStatus = 3;
  bus.emitEvent("heartbeat", { monitorId, heartbeat: beat });
}

// Re-evaluates active maintenance windows and reconciles scheduler state:
// entering monitors get one maintenance beat; exiting monitors resume with an
// immediate check. Runs on a timer and on demand after config changes.
function maintenanceTick(): void {
  const next = monitorIdsUnderMaintenance();
  const prev = underMaintenance;

  const entered: number[] = [];
  const exited: number[] = [];
  for (const id of next) if (!prev.has(id)) entered.push(id);
  for (const id of prev) if (!next.has(id)) exited.push(id);

  // Publish the new set before resuming exited monitors so their executeCheck
  // (which reads underMaintenance) is no longer suspended.
  underMaintenance = next;

  for (const id of entered) {
    const task = tasks.get(id);
    if (task && task.lastStatus !== 3) writeMaintenanceBeat(id, task);
  }
  for (const id of exited) {
    const monitor = db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (monitor && tasks.get(id)) void executeCheck(monitor);
  }
}

/** Forces an immediate maintenance re-evaluation (called after CRUD changes). */
export function syncMaintenanceNow(): void {
  maintenanceTick();
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
  // Seed the maintenance set before starting tasks so a monitor already inside
  // a window skips its initial check instead of writing a normal beat.
  underMaintenance = monitorIdsUnderMaintenance();

  const all = db.select().from(monitors).all();
  for (const monitor of all) start(monitor);

  // Mark monitors that booted inside a window with their maintenance beat.
  for (const id of underMaintenance) {
    const task = tasks.get(id);
    if (task && task.lastStatus !== 3) writeMaintenanceBeat(id, task);
  }

  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = setInterval(maintenanceTick, MAINTENANCE_TICK_MS);

  console.log(`[scheduler] started ${all.length} monitor(s)`);
}
