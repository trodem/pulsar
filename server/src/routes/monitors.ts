import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { monitorNotifications, monitors } from "../db/schema.js";
import { monitorStats, recentHeartbeats } from "../monitors/stats.js";
import { reschedule, unschedule } from "../monitors/scheduler.js";
import {
  checkMonitorUsers,
  getStapError,
  getStapUsers,
  isStapMonitor,
  listLogFolder,
  logFolderForTarget,
} from "../monitors/stap-users.js";

const router = Router();

// Logged users for a STAP monitor (http-ping type), else undefined so the
// field is omitted from other monitors.
function stapUsersFor(m: { id: number; type: string }): string[] | undefined {
  return isStapMonitor(m) ? getStapUsers(m.id) : undefined;
}

// Current log-read error for a STAP monitor (null when healthy), else undefined.
function stapErrorFor(m: {
  id: number;
  type: string;
}): string | null | undefined {
  return isStapMonitor(m) ? getStapError(m.id) : undefined;
}

const monitorSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["http", "tcp", "ping", "http-ping"]),
  target: z.string().min(1).max(500),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  interval: z.number().int().min(5).max(86400).default(60),
  timeout: z.number().int().min(1).max(120).default(10),
  retries: z.number().int().min(0).max(10).default(0),
  acceptedStatus: z.string().default("200-299"),
  method: z.string().default("GET"),
  active: z.boolean().default(true),
  notificationIds: z.array(z.number().int()).default([]),
});

function setMonitorNotifications(monitorId: number, ids: number[]) {
  db.delete(monitorNotifications)
    .where(eq(monitorNotifications.monitorId, monitorId))
    .run();
  for (const notificationId of ids) {
    db.insert(monitorNotifications)
      .values({ monitorId, notificationId })
      .run();
  }
}

function linkedNotificationIds(monitorId: number): number[] {
  return db
    .select({ id: monitorNotifications.notificationId })
    .from(monitorNotifications)
    .where(eq(monitorNotifications.monitorId, monitorId))
    .all()
    .map((r) => r.id);
}

// List monitors with live status + stats for the dashboard.
router.get("/", (_req, res) => {
  const all = db.select().from(monitors).all();
  const data = all.map((m) => ({
    ...m,
    stats: monitorStats(m.id),
    heartbeats: recentHeartbeats(m.id, 40),
    users: stapUsersFor(m),
    usersError: stapErrorFor(m),
  }));
  res.json(data);
});

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const monitor = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  res.json({
    ...monitor,
    stats: monitorStats(id),
    heartbeats: recentHeartbeats(id, 100),
    notificationIds: linkedNotificationIds(id),
    users: stapUsersFor(monitor),
    usersError: stapErrorFor(monitor),
  });
});

router.post("/", (req, res) => {
  const parsed = monitorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { notificationIds, ...values } = parsed.data;
  const [created] = db
    .insert(monitors)
    .values({ ...values, port: values.port ?? null })
    .returning()
    .all();
  setMonitorNotifications(created.id, notificationIds);
  reschedule(created.id);
  res.status(201).json(created);
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  const parsed = monitorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { notificationIds, ...values } = parsed.data;
  const [updated] = db
    .update(monitors)
    .set({ ...values, port: values.port ?? null })
    .where(eq(monitors.id, id))
    .returning()
    .all();
  setMonitorNotifications(id, notificationIds);
  reschedule(id);
  res.json(updated);
});

// Quick enable/disable toggle.
router.patch("/:id/toggle", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  const [updated] = db
    .update(monitors)
    .set({ active: !existing.active })
    .where(eq(monitors.id, id))
    .returning()
    .all();
  reschedule(id);
  res.json(updated);
});

// Reads the monitor's full remote log now and returns the logged-in users.
// Triggered manually by the "Check users" button (there is no background poll).
router.post("/:id/check-users", async (req, res) => {
  const id = Number(req.params.id);
  const monitor = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  if (!isStapMonitor(monitor)) {
    res.status(400).json({ error: "Only http-ping monitors have users" });
    return;
  }
  const { users, error } = await checkMonitorUsers(monitor);
  res.json({ users, error });
});

// Lists the files inside the monitor's remote log folder (for the modal).
router.get("/:id/log-files", async (req, res) => {
  const id = Number(req.params.id);
  const monitor = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  if (!isStapMonitor(monitor)) {
    res.status(400).json({ error: "Only http-ping monitors have a log folder" });
    return;
  }
  try {
    const files = await listLogFolder(monitor.target);
    res.json({ folder: logFolderForTarget(monitor.target), files });
  } catch (err) {
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Cannot read folder" });
  }
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  unschedule(id);
  db.delete(monitors).where(eq(monitors.id, id)).run();
  res.status(204).end();
});

export default router;
