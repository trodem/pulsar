import { Router } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  maintenanceGroups,
  maintenanceMonitors,
  maintenances,
  type Maintenance,
} from "../db/schema.js";
import { syncMaintenanceNow } from "../monitors/scheduler.js";
import { asyncHandler } from "../http.js";

const router = Router();

const maintenanceSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  strategy: z.enum(["single", "daily", "weekly", "monthly"]),
  active: z.boolean().default(true),
  // Validity range (unix seconds); required for "single", optional otherwise.
  startDate: z.number().int().nullable().optional(),
  endDate: z.number().int().nullable().optional(),
  // Daily time window in minutes from midnight (recurring strategies).
  startTime: z.number().int().min(0).max(1439).nullable().optional(),
  endTime: z.number().int().min(0).max(1439).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  daysOfMonth: z.array(z.number().int().min(1).max(31)).default([]),
  monitorIds: z.array(z.number().int()).default([]),
  groupIds: z.array(z.number().int()).default([]),
});

async function linkedMonitorIds(maintenanceId: number): Promise<number[]> {
  return (
    await db
      .select({ id: maintenanceMonitors.monitorId })
      .from(maintenanceMonitors)
      .where(eq(maintenanceMonitors.maintenanceId, maintenanceId))
      .all()
  ).map((r) => r.id);
}

async function linkedGroupIds(maintenanceId: number): Promise<number[]> {
  return (
    await db
      .select({ id: maintenanceGroups.groupId })
      .from(maintenanceGroups)
      .where(eq(maintenanceGroups.maintenanceId, maintenanceId))
      .all()
  ).map((r) => r.id);
}

async function setLinks(
  maintenanceId: number,
  monitorIds: number[],
  groupIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(maintenanceMonitors)
      .where(eq(maintenanceMonitors.maintenanceId, maintenanceId))
      .run();
    for (const monitorId of monitorIds) {
      await tx
        .insert(maintenanceMonitors)
        .values({ maintenanceId, monitorId })
        .run();
    }
    await tx
      .delete(maintenanceGroups)
      .where(eq(maintenanceGroups.maintenanceId, maintenanceId))
      .run();
    for (const groupId of groupIds) {
      await tx.insert(maintenanceGroups).values({ maintenanceId, groupId }).run();
    }
  });
}

// Serializes a row for the client: JSON day columns become arrays, links added.
async function serialize(m: Maintenance) {
  return {
    ...m,
    daysOfWeek: JSON.parse(m.daysOfWeek) as number[],
    daysOfMonth: JSON.parse(m.daysOfMonth) as number[],
    monitorIds: await linkedMonitorIds(m.id),
    groupIds: await linkedGroupIds(m.id),
  };
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db
      .select()
      .from(maintenances)
      .orderBy(desc(maintenances.active), asc(maintenances.title))
      .all();
    res.json(await Promise.all(all.map(serialize)));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const m = await db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id))
      .get();
    if (!m) {
      res.status(404).json({ error: "Maintenance not found" });
      return;
    }
    res.json(await serialize(m));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { monitorIds, groupIds, daysOfWeek, daysOfMonth, ...values } =
      parsed.data;
    const [created] = await db
      .insert(maintenances)
      .values({
        ...values,
        startDate: values.startDate ?? null,
        endDate: values.endDate ?? null,
        startTime: values.startTime ?? null,
        endTime: values.endTime ?? null,
        daysOfWeek: JSON.stringify(daysOfWeek),
        daysOfMonth: JSON.stringify(daysOfMonth),
      })
      .returning()
      .all();
    await setLinks(created.id, monitorIds, groupIds);
    await syncMaintenanceNow();
    res.status(201).json(await serialize(created));
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id))
      .get();
    if (!existing) {
      res.status(404).json({ error: "Maintenance not found" });
      return;
    }
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { monitorIds, groupIds, daysOfWeek, daysOfMonth, ...values } =
      parsed.data;
    const [updated] = await db
      .update(maintenances)
      .set({
        ...values,
        startDate: values.startDate ?? null,
        endDate: values.endDate ?? null,
        startTime: values.startTime ?? null,
        endTime: values.endTime ?? null,
        daysOfWeek: JSON.stringify(daysOfWeek),
        daysOfMonth: JSON.stringify(daysOfMonth),
      })
      .where(eq(maintenances.id, id))
      .returning()
      .all();
    await setLinks(id, monitorIds, groupIds);
    await syncMaintenanceNow();
    res.json(await serialize(updated));
  }),
);

// Quick enable/disable toggle for the master switch.
router.patch(
  "/:id/toggle",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db
      .select()
      .from(maintenances)
      .where(eq(maintenances.id, id))
      .get();
    if (!existing) {
      res.status(404).json({ error: "Maintenance not found" });
      return;
    }
    const [updated] = await db
      .update(maintenances)
      .set({ active: !existing.active })
      .where(eq(maintenances.id, id))
      .returning()
      .all();
    await syncMaintenanceNow();
    res.json(await serialize(updated));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(maintenances).where(eq(maintenances.id, id)).run();
    await syncMaintenanceNow();
    res.status(204).end();
  }),
);

export default router;
