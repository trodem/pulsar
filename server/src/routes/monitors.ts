import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  monitorNotifications,
  monitorTags,
  monitors,
  tags,
  type Tag,
} from "../db/schema.js";
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
import { restartStapProgram } from "../monitors/stap-control.js";

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
  groupId: z.number().int().nullable().optional(),
  interval: z.number().int().min(5).max(86400).default(60),
  timeout: z.number().int().min(1).max(120).default(10),
  retries: z.number().int().min(0).max(10).default(0),
  acceptedStatus: z.string().default("200-299"),
  method: z.string().default("GET"),
  active: z.boolean().default(true),
  notificationIds: z.array(z.number().int()).default([]),
  tagIds: z.array(z.number().int()).default([]),
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

function setMonitorTags(monitorId: number, ids: number[]) {
  db.delete(monitorTags).where(eq(monitorTags.monitorId, monitorId)).run();
  for (const tagId of ids) {
    db.insert(monitorTags).values({ monitorId, tagId }).run();
  }
}

// Full tag objects (with color) attached to a monitor, for rendering chips.
function tagsForMonitor(monitorId: number): Tag[] {
  return db
    .select({ tag: tags })
    .from(monitorTags)
    .innerJoin(tags, eq(monitorTags.tagId, tags.id))
    .where(eq(monitorTags.monitorId, monitorId))
    .all()
    .map((r) => r.tag);
}

// Loads the tags for many monitors at once, grouped by monitor id, so the list
// endpoint doesn't run one query per monitor.
function tagsByMonitor(monitorIds: number[]): Map<number, Tag[]> {
  const byMonitor = new Map<number, Tag[]>();
  if (monitorIds.length === 0) return byMonitor;
  const rows = db
    .select({ monitorId: monitorTags.monitorId, tag: tags })
    .from(monitorTags)
    .innerJoin(tags, eq(monitorTags.tagId, tags.id))
    .where(inArray(monitorTags.monitorId, monitorIds))
    .all();
  for (const { monitorId, tag } of rows) {
    const list = byMonitor.get(monitorId) ?? [];
    list.push(tag);
    byMonitor.set(monitorId, list);
  }
  return byMonitor;
}

// List monitors with live status + stats for the dashboard.
router.get("/", (_req, res) => {
  const all = db.select().from(monitors).all();
  const tagMap = tagsByMonitor(all.map((m) => m.id));
  const data = all.map((m) => ({
    ...m,
    stats: monitorStats(m.id),
    heartbeats: recentHeartbeats(m.id, 40),
    tags: tagMap.get(m.id) ?? [],
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
  const tagList = tagsForMonitor(id);
  res.json({
    ...monitor,
    stats: monitorStats(id),
    heartbeats: recentHeartbeats(id, 100),
    notificationIds: linkedNotificationIds(id),
    tags: tagList,
    tagIds: tagList.map((t) => t.id),
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
  const { notificationIds, tagIds, ...values } = parsed.data;
  const [created] = db
    .insert(monitors)
    .values({ ...values, port: values.port ?? null, groupId: values.groupId ?? null })
    .returning()
    .all();
  setMonitorNotifications(created.id, notificationIds);
  setMonitorTags(created.id, tagIds);
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
  const { notificationIds, tagIds, ...values } = parsed.data;
  const [updated] = db
    .update(monitors)
    .set({ ...values, port: values.port ?? null, groupId: values.groupId ?? null })
    .where(eq(monitors.id, id))
    .returning()
    .all();
  setMonitorNotifications(id, notificationIds);
  setMonitorTags(id, tagIds);
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

// Stops the running STAP backend executable on the monitor's host and starts a
// fresh one (or just starts it if it wasn't running). Triggered manually by the
// "Restart" button on the monitor card. http-ping monitors only.
router.post("/:id/restart-program", async (req, res) => {
  const id = Number(req.params.id);
  const monitor = db.select().from(monitors).where(eq(monitors.id, id)).get();
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  if (!isStapMonitor(monitor)) {
    res.status(400).json({ error: "Only http-ping monitors can be restarted" });
    return;
  }
  // Guard: never restart while anyone is still logged in. Read the remote log
  // now (this also refreshes the users shown on the card). If it can't be read,
  // we can't prove nobody is online, so we refuse rather than risk it.
  const { users, error } = await checkMonitorUsers(monitor);
  if (error) {
    res.status(502).json({ error: `Cannot verify online users: ${error}` });
    return;
  }
  if (users.length > 0) {
    res.status(409).json({
      error: `Cannot restart: ${users.length} user(s) online — ${users.join(", ")}`,
      users,
    });
    return;
  }
  try {
    const message = await restartStapProgram(monitor);
    res.json({ ok: true, message });
  } catch (err) {
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Restart failed" });
  }
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
