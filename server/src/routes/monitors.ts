import { Router, text } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  groups,
  monitorNotifications,
  monitorTags,
  monitors,
  tags,
  type Tag,
} from "../db/schema.js";
import {
  CsvError,
  monitorsToCsv,
  parseMonitorsCsv,
  type MonitorCsv,
} from "./../monitors/csv.js";
import {
  heartbeatsSince,
  monitorStats,
  recentHeartbeats,
} from "../monitors/stats.js";
import { reschedule, unschedule } from "../monitors/scheduler.js";
import { probePing } from "../monitors/checkers.js";
import {
  checkMonitorUsers,
  getStapError,
  getStapUsers,
  isStapMonitor,
  listLogFolder,
  logFolderForTarget,
} from "../monitors/stap-users.js";
import { restartStapProgram } from "../monitors/stap-control.js";
import { asyncHandler } from "../http.js";

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

// Resolves a monitor's bare hostname for an ICMP ping: the URL host for
// http(-ping) targets, otherwise the plain target with any port/path stripped.
function hostForMonitor(m: { target: string }): string {
  try {
    return new URL(m.target).hostname || m.target;
  } catch {
    return m.target.split("/")[0].split(":")[0].trim();
  }
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

async function setMonitorNotifications(monitorId: number, ids: number[]) {
  await db.transaction(async (tx) => {
    await tx
      .delete(monitorNotifications)
      .where(eq(monitorNotifications.monitorId, monitorId))
      .run();
    for (const notificationId of ids) {
      await tx
        .insert(monitorNotifications)
        .values({ monitorId, notificationId })
        .run();
    }
  });
}

async function linkedNotificationIds(monitorId: number): Promise<number[]> {
  return (
    await db
      .select({ id: monitorNotifications.notificationId })
      .from(monitorNotifications)
      .where(eq(monitorNotifications.monitorId, monitorId))
      .all()
  ).map((r) => r.id);
}

async function setMonitorTags(monitorId: number, ids: number[]) {
  await db.transaction(async (tx) => {
    await tx
      .delete(monitorTags)
      .where(eq(monitorTags.monitorId, monitorId))
      .run();
    for (const tagId of ids) {
      await tx.insert(monitorTags).values({ monitorId, tagId }).run();
    }
  });
}

// Full tag objects (with color) attached to a monitor, for rendering chips.
async function tagsForMonitor(monitorId: number): Promise<Tag[]> {
  return (
    await db
      .select({ tag: tags })
      .from(monitorTags)
      .innerJoin(tags, eq(monitorTags.tagId, tags.id))
      .where(eq(monitorTags.monitorId, monitorId))
      .all()
  ).map((r) => r.tag);
}

// Loads the tags for many monitors at once, grouped by monitor id, so the list
// endpoint doesn't run one query per monitor.
async function tagsByMonitor(
  monitorIds: number[],
): Promise<Map<number, Tag[]>> {
  const byMonitor = new Map<number, Tag[]>();
  if (monitorIds.length === 0) return byMonitor;
  const rows = await db
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

// List monitors with live status + stats for the dashboard. Ordered by the
// manual drag-and-drop position (then id) so the saved card order is preserved.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db
      .select()
      .from(monitors)
      .orderBy(asc(monitors.position), asc(monitors.id))
      .all();
    const tagMap = await tagsByMonitor(all.map((m) => m.id));
    const data = await Promise.all(
      all.map(async (m) => ({
        ...m,
        stats: await monitorStats(m.id),
        heartbeats: await recentHeartbeats(m.id, 40),
        tags: tagMap.get(m.id) ?? [],
        users: stapUsersFor(m),
        usersError: stapErrorFor(m),
      })),
    );
    res.json(data);
  }),
);

// Exports every monitor (with its group name and tag names) as a CSV download.
// Registered before the `/:id` routes so "export" isn't captured as a monitor id.
router.get(
  "/export/monitors",
  asyncHandler(async (_req, res) => {
    const groupNameById = new Map(
      (await db.select({ id: groups.id, name: groups.name }).from(groups).all())
        .map((g) => [g.id, g.name] as const),
    );

    const all = await db
      .select()
      .from(monitors)
      .orderBy(asc(monitors.id))
      .all();
    const tagMap = await tagsByMonitor(all.map((m) => m.id));

    const rows: MonitorCsv[] = all.map((m) => ({
      name: m.name,
      type: m.type as MonitorCsv["type"],
      target: m.target,
      group: m.groupId != null ? groupNameById.get(m.groupId) ?? null : null,
      tags: (tagMap.get(m.id) ?? []).map((t) => t.name),
    }));

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="pulsar-monitors-${stamp}.csv"`,
    );
    res.send(monitorsToCsv(rows));
  }),
);

// Imports monitors from an uploaded CSV. The client posts the raw file text
// (Content-Type text/csv). Validates the format, then creates each monitor,
// resolving its group and tags by name (creating any that don't exist yet).
// Monitors whose name already exists are skipped so re-importing is safe.
router.post(
  "/import/monitors",
  text({ type: ["text/csv", "text/plain"], limit: "20mb" }),
  asyncHandler(async (req, res) => {
    const csv = typeof req.body === "string" ? req.body : "";
    let rows;
    try {
      rows = parseMonitorsCsv(csv);
    } catch (err) {
      if (err instanceof CsvError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const existingNames = new Set(
      (await db.select({ name: monitors.name }).from(monitors).all()).map(
        (m) => m.name,
      ),
    );

    const created: number[] = [];
    let skipped = 0;

    await db.transaction(async (tx) => {
      // Resolve a group name to its id, creating the group on first use. Cached
      // so several monitors sharing a group don't each re-query/insert it.
      const groupCache = new Map<string, number>();
      async function groupIdFor(name: string): Promise<number> {
        const key = name.toLowerCase();
        const cached = groupCache.get(key);
        if (cached != null) return cached;
        const found = (await tx.select().from(groups).all()).find(
          (g) => g.name.toLowerCase() === key,
        );
        const id = found
          ? found.id
          : (await tx.insert(groups).values({ name }).returning().all())[0].id;
        groupCache.set(key, id);
        return id;
      }

      // Resolve a tag name to its id, creating the tag (with the default color)
      // on first use. Cached for the same reason as groups.
      const tagCache = new Map<string, number>();
      async function tagIdFor(name: string): Promise<number> {
        const key = name.toLowerCase();
        const cached = tagCache.get(key);
        if (cached != null) return cached;
        const found = (await tx.select().from(tags).all()).find(
          (t) => t.name.toLowerCase() === key,
        );
        const id = found
          ? found.id
          : (await tx.insert(tags).values({ name }).returning().all())[0].id;
        tagCache.set(key, id);
        return id;
      }

      for (const r of rows) {
        if (existingNames.has(r.name)) {
          skipped++;
          continue;
        }
        existingNames.add(r.name);

        // Only name/type/target/group/tags come from the CSV; every other
        // monitor setting falls back to the schema defaults.
        const groupId = r.group != null ? await groupIdFor(r.group) : null;
        const [monitor] = await tx
          .insert(monitors)
          .values({
            name: r.name,
            type: r.type,
            target: r.target,
            groupId,
          })
          .returning()
          .all();

        for (const tagName of r.tags) {
          await tx
            .insert(monitorTags)
            .values({ monitorId: monitor.id, tagId: await tagIdFor(tagName) })
            .run();
        }
        created.push(monitor.id);
      }
    });

    // Start the scheduler for each newly created (active) monitor.
    for (const id of created) await reschedule(id);

    res.json({ imported: created.length, skipped });
  }),
);

// Persists a new card order (and group membership). The client sends every
// monitor in the desired display order, each with the group it now belongs to;
// the monitor's `position` is set to its index and its `group_id` updated so a
// card dragged into another group sticks. Registered before `/:id` so "reorder"
// isn't captured as a monitor id.
router.put(
  "/reorder",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        items: z.array(
          z.object({
            id: z.number().int(),
            groupId: z.number().int().nullable(),
          }),
        ),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { items } = parsed.data;
    await db.transaction(async (tx) => {
      for (const [index, item] of items.entries()) {
        await tx
          .update(monitors)
          .set({ position: index, groupId: item.groupId })
          .where(eq(monitors.id, item.id))
          .run();
      }
    });
    res.status(204).end();
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!monitor) {
      res.status(404).json({ error: "Monitor not found" });
      return;
    }
    const tagList = await tagsForMonitor(id);
    res.json({
      ...monitor,
      stats: await monitorStats(id),
      heartbeats: await recentHeartbeats(id, 100),
      notificationIds: await linkedNotificationIds(id),
      tags: tagList,
      tagIds: tagList.map((t) => t.id),
      users: stapUsersFor(monitor),
      usersError: stapErrorFor(monitor),
    });
  }),
);

// Heartbeats within an adjustable time window (detail view's scale control).
// `hours` is clamped to 1..24; returns every beat in the window, chronological.
router.get(
  "/:id/heartbeats",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const hours = Math.min(24, Math.max(1, Number(req.query.hours) || 6));
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!monitor) {
      res.status(404).json({ error: "Monitor not found" });
      return;
    }
    res.json({ hours, heartbeats: await heartbeatsSince(id, hours) });
  }),
);

// One-off ICMP ping against the monitor's host, triggered by the "Test ping"
// button in the detail view. Read-only, so mounted as GET — this keeps it
// usable by read-only accounts (requireWrite only gates non-GET requests).
router.get(
  "/:id/ping",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!monitor) {
      res.status(404).json({ error: "Monitor not found" });
      return;
    }
    const host = hostForMonitor(monitor);
    const result = await probePing(host, monitor.timeout);
    res.json({
      host,
      alive: result.alive,
      time: result.time,
      message: result.message,
    });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = monitorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { notificationIds, tagIds, ...values } = parsed.data;
    const [created] = await db
      .insert(monitors)
      .values({
        ...values,
        port: values.port ?? null,
        groupId: values.groupId ?? null,
      })
      .returning()
      .all();
    await setMonitorNotifications(created.id, notificationIds);
    await setMonitorTags(created.id, tagIds);
    await reschedule(created.id);
    res.status(201).json(created);
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
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
    const [updated] = await db
      .update(monitors)
      .set({
        ...values,
        port: values.port ?? null,
        groupId: values.groupId ?? null,
      })
      .where(eq(monitors.id, id))
      .returning()
      .all();
    await setMonitorNotifications(id, notificationIds);
    await setMonitorTags(id, tagIds);
    await reschedule(id);
    res.json(updated);
  }),
);

// Quick enable/disable toggle.
router.patch(
  "/:id/toggle",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!existing) {
      res.status(404).json({ error: "Monitor not found" });
      return;
    }
    const [updated] = await db
      .update(monitors)
      .set({ active: !existing.active })
      .where(eq(monitors.id, id))
      .returning()
      .all();
    await reschedule(id);
    res.json(updated);
  }),
);

// Reads the monitor's full remote log now and returns the logged-in users.
// Triggered manually by the "Check users" button (there is no background poll).
router.post(
  "/:id/check-users",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
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
  }),
);

// Stops the running STAP backend executable on the monitor's host and starts a
// fresh one (or just starts it if it wasn't running). Triggered manually by the
// "Restart" button on the monitor card. http-ping monitors only.
router.post(
  "/:id/restart-program",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!monitor) {
      res.status(404).json({ error: "Monitor not found" });
      return;
    }
    if (!isStapMonitor(monitor)) {
      res
        .status(400)
        .json({ error: "Only http-ping monitors can be restarted" });
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
  }),
);

// Lists the files inside the monitor's remote log folder (for the modal).
router.get(
  "/:id/log-files",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!monitor) {
      res.status(404).json({ error: "Monitor not found" });
      return;
    }
    if (!isStapMonitor(monitor)) {
      res
        .status(400)
        .json({ error: "Only http-ping monitors have a log folder" });
      return;
    }
    try {
      const files = await listLogFolder(monitor.target);
      res.json({ folder: logFolderForTarget(monitor.target), files });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Cannot read folder",
      });
    }
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    unschedule(id);
    await db.delete(monitors).where(eq(monitors.id, id)).run();
    res.status(204).end();
  }),
);

export default router;
