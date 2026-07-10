import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  monitorNotifications,
  notificationGroups,
  notifications,
} from "../db/schema.js";
import { testNotification } from "../notifications/index.js";
import { asyncHandler } from "../http.js";

const router = Router();

const notificationSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["webhook", "telegram", "teams"]),
  config: z.record(z.string(), z.any()).default({}),
  active: z.boolean().default(true),
  // Targets this notification fires for: individual monitors and/or whole
  // groups. Monitor links live in the shared monitor_notifications table (also
  // editable from the monitor form); group links in notification_groups.
  monitorIds: z.array(z.number().int()).default([]),
  groupIds: z.array(z.number().int()).default([]),
});

async function linkedMonitorIds(notificationId: number): Promise<number[]> {
  return (
    await db
      .select({ id: monitorNotifications.monitorId })
      .from(monitorNotifications)
      .where(eq(monitorNotifications.notificationId, notificationId))
      .all()
  ).map((r) => r.id);
}

async function linkedGroupIds(notificationId: number): Promise<number[]> {
  return (
    await db
      .select({ id: notificationGroups.groupId })
      .from(notificationGroups)
      .where(eq(notificationGroups.notificationId, notificationId))
      .all()
  ).map((r) => r.id);
}

async function setLinks(
  notificationId: number,
  monitorIds: number[],
  groupIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(monitorNotifications)
      .where(eq(monitorNotifications.notificationId, notificationId))
      .run();
    for (const monitorId of monitorIds) {
      await tx
        .insert(monitorNotifications)
        .values({ monitorId, notificationId })
        .run();
    }
    await tx
      .delete(notificationGroups)
      .where(eq(notificationGroups.notificationId, notificationId))
      .run();
    for (const groupId of groupIds) {
      await tx
        .insert(notificationGroups)
        .values({ notificationId, groupId })
        .run();
    }
  });
}

async function serialize(n: typeof notifications.$inferSelect) {
  return {
    ...n,
    config: safeParse(n.config),
    monitorIds: await linkedMonitorIds(n.id),
    groupIds: await linkedGroupIds(n.id),
  };
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db.select().from(notifications).all();
    res.json(await Promise.all(all.map(serialize)));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = notificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [created] = await db
      .insert(notifications)
      .values({
        name: parsed.data.name,
        type: parsed.data.type,
        config: JSON.stringify(parsed.data.config),
        active: parsed.data.active,
      })
      .returning()
      .all();
    await setLinks(created.id, parsed.data.monitorIds, parsed.data.groupIds);
    res.status(201).json(await serialize(created));
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = notificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [updated] = await db
      .update(notifications)
      .set({
        name: parsed.data.name,
        type: parsed.data.type,
        config: JSON.stringify(parsed.data.config),
        active: parsed.data.active,
      })
      .where(eq(notifications.id, id))
      .returning()
      .all();
    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    await setLinks(id, parsed.data.monitorIds, parsed.data.groupIds);
    res.json(await serialize(updated));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(notifications).where(eq(notifications.id, id)).run();
    res.status(204).end();
  }),
);

// Send a test message using a provided (unsaved) config.
router.post("/test", async (req, res) => {
  const schema = z.object({
    type: z.enum(["webhook", "telegram", "teams"]),
    config: z.record(z.string(), z.any()).default({}),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid test payload" });
    return;
  }
  try {
    await testNotification(parsed.data.type, parsed.data.config);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Test failed",
    });
  }
});

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

export default router;
