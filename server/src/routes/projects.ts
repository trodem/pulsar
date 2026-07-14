import { Router } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { monitors, projects, vehicles } from "../db/schema.js";
import { asyncHandler } from "../http.js";

const router = Router();

const projectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
});

const vehicleSchema = z.object({
  name: z.string().min(1).max(100),
});

const assignSchema = z.object({
  monitorIds: z.array(z.number().int().positive()).default([]),
});

// Alle Projekte inkl. ihrer Fahrzeuge und der daran zugewiesenen Monitore
// (id + name reichen für die Karten; Status kommt im Client aus dem Monitor-Store).
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const allProjects = await db
      .select()
      .from(projects)
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .all();
    const allVehicles = await db
      .select()
      .from(vehicles)
      .orderBy(asc(vehicles.createdAt), asc(vehicles.id))
      .all();
    // Nur die für die Zuordnung nötigen Monitor-Felder laden.
    const assigned = await db
      .select({
        id: monitors.id,
        name: monitors.name,
        vehicleId: monitors.vehicleId,
      })
      .from(monitors)
      .all();

    const monitorsByVehicle = new Map<number, { id: number; name: string }[]>();
    for (const m of assigned) {
      if (m.vehicleId == null) continue;
      const list = monitorsByVehicle.get(m.vehicleId) ?? [];
      list.push({ id: m.id, name: m.name });
      monitorsByVehicle.set(m.vehicleId, list);
    }

    const vehiclesByProject = new Map<number, unknown[]>();
    for (const v of allVehicles) {
      const list = vehiclesByProject.get(v.projectId) ?? [];
      list.push({ ...v, monitors: monitorsByVehicle.get(v.id) ?? [] });
      vehiclesByProject.set(v.projectId, list);
    }

    res.json(
      allProjects.map((p) => ({
        ...p,
        vehicles: vehiclesByProject.get(p.id) ?? [],
      })),
    );
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [created] = await db
      .insert(projects)
      .values(parsed.data)
      .returning()
      .all();
    res.status(201).json({ ...created, vehicles: [] });
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [updated] = await db
      .update(projects)
      .set(parsed.data)
      .where(eq(projects.id, id))
      .returning()
      .all();
    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(updated);
  }),
);

// Ein Projekt zu löschen entfernt via ON DELETE CASCADE auch seine Fahrzeuge;
// die Monitore bleiben erhalten (ihr vehicle_id wird per ON DELETE SET NULL geleert).
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(projects).where(eq(projects.id, id)).run();
    res.status(204).end();
  }),
);

// --- Fahrzeuge ---

// Neues Fahrzeug in einem Projekt anlegen.
router.post(
  "/:id/vehicles",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const parsed = vehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const [created] = await db
      .insert(vehicles)
      .values({ projectId, name: parsed.data.name })
      .returning()
      .all();
    res.status(201).json({ ...created, monitors: [] });
  }),
);

// Fahrzeug umbenennen. Zwei-Segment-Pfad, kollidiert nicht mit PUT "/:id".
router.put(
  "/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.vehicleId);
    const parsed = vehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [updated] = await db
      .update(vehicles)
      .set({ name: parsed.data.name })
      .where(eq(vehicles.id, id))
      .returning()
      .all();
    if (!updated) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    res.json(updated);
  }),
);

// Fahrzeug löschen. Die zugewiesenen Monitore werden per ON DELETE SET NULL frei.
router.delete(
  "/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.vehicleId);
    await db.delete(vehicles).where(eq(vehicles.id, id)).run();
    res.status(204).end();
  }),
);

// Setzt die Menge der einem Fahrzeug zugewiesenen Monitore (voller Ersatz):
// erst alle bisher zugewiesenen lösen, dann die übergebenen zuweisen.
router.put(
  "/vehicles/:vehicleId/monitors",
  asyncHandler(async (req, res) => {
    const vehicleId = Number(req.params.vehicleId);
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const vehicle = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .get();
    if (!vehicle) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    // Bisherige Zuordnung dieses Fahrzeugs aufheben ...
    await db
      .update(monitors)
      .set({ vehicleId: null })
      .where(eq(monitors.vehicleId, vehicleId))
      .run();
    // ... dann die ausgewählten Monitore zuweisen (räumt sie zugleich aus einem
    // evtl. anderen Fahrzeug ab, da vehicle_id eindeutig pro Monitor ist).
    if (parsed.data.monitorIds.length > 0) {
      await db
        .update(monitors)
        .set({ vehicleId })
        .where(inArray(monitors.id, parsed.data.monitorIds))
        .run();
    }
    res.status(204).end();
  }),
);

export default router;
