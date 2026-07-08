import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { monitorNotifications, monitors } from "../db/schema.js";
import { monitorStats, recentHeartbeats } from "../monitors/stats.js";
import { reschedule, unschedule } from "../monitors/scheduler.js";

const router = Router();

const monitorSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["http", "tcp", "ping"]),
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

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  unschedule(id);
  db.delete(monitors).where(eq(monitors.id, id)).run();
  res.status(204).end();
});

export default router;
