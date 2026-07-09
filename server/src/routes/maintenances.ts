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

function linkedMonitorIds(maintenanceId: number): number[] {
  return db
    .select({ id: maintenanceMonitors.monitorId })
    .from(maintenanceMonitors)
    .where(eq(maintenanceMonitors.maintenanceId, maintenanceId))
    .all()
    .map((r) => r.id);
}

function linkedGroupIds(maintenanceId: number): number[] {
  return db
    .select({ id: maintenanceGroups.groupId })
    .from(maintenanceGroups)
    .where(eq(maintenanceGroups.maintenanceId, maintenanceId))
    .all()
    .map((r) => r.id);
}

function setLinks(
  maintenanceId: number,
  monitorIds: number[],
  groupIds: number[],
): void {
  db.delete(maintenanceMonitors)
    .where(eq(maintenanceMonitors.maintenanceId, maintenanceId))
    .run();
  for (const monitorId of monitorIds) {
    db.insert(maintenanceMonitors).values({ maintenanceId, monitorId }).run();
  }
  db.delete(maintenanceGroups)
    .where(eq(maintenanceGroups.maintenanceId, maintenanceId))
    .run();
  for (const groupId of groupIds) {
    db.insert(maintenanceGroups).values({ maintenanceId, groupId }).run();
  }
}

// Serializes a row for the client: JSON day columns become arrays, links added.
function serialize(m: Maintenance) {
  return {
    ...m,
    daysOfWeek: JSON.parse(m.daysOfWeek) as number[],
    daysOfMonth: JSON.parse(m.daysOfMonth) as number[],
    monitorIds: linkedMonitorIds(m.id),
    groupIds: linkedGroupIds(m.id),
  };
}

router.get("/", (_req, res) => {
  const all = db
    .select()
    .from(maintenances)
    .orderBy(desc(maintenances.active), asc(maintenances.title))
    .all();
  res.json(all.map(serialize));
});

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const m = db.select().from(maintenances).where(eq(maintenances.id, id)).get();
  if (!m) {
    res.status(404).json({ error: "Maintenance not found" });
    return;
  }
  res.json(serialize(m));
});

router.post("/", (req, res) => {
  const parsed = maintenanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { monitorIds, groupIds, daysOfWeek, daysOfMonth, ...values } =
    parsed.data;
  const [created] = db
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
  setLinks(created.id, monitorIds, groupIds);
  syncMaintenanceNow();
  res.status(201).json(serialize(created));
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db
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
  const [updated] = db
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
  setLinks(id, monitorIds, groupIds);
  syncMaintenanceNow();
  res.json(serialize(updated));
});

// Quick enable/disable toggle for the master switch.
router.patch("/:id/toggle", (req, res) => {
  const id = Number(req.params.id);
  const existing = db
    .select()
    .from(maintenances)
    .where(eq(maintenances.id, id))
    .get();
  if (!existing) {
    res.status(404).json({ error: "Maintenance not found" });
    return;
  }
  const [updated] = db
    .update(maintenances)
    .set({ active: !existing.active })
    .where(eq(maintenances.id, id))
    .returning()
    .all();
  syncMaintenanceNow();
  res.json(serialize(updated));
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.delete(maintenances).where(eq(maintenances.id, id)).run();
  syncMaintenanceNow();
  res.status(204).end();
});

export default router;
