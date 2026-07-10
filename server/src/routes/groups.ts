import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { groups } from "../db/schema.js";
import { asyncHandler } from "../http.js";

const router = Router();

const groupSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.number().int().min(0).max(100000).default(0),
});

// Sections in dashboard order (position, then name).
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db
      .select()
      .from(groups)
      .orderBy(asc(groups.position), asc(groups.name))
      .all();
    res.json(all);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [created] = await db
      .insert(groups)
      .values(parsed.data)
      .returning()
      .all();
    res.status(201).json(created);
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const [updated] = await db
      .update(groups)
      .set(parsed.data)
      .where(eq(groups.id, id))
      .returning()
      .all();
    if (!updated) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    res.json(updated);
  }),
);

// Deleting a group leaves its monitors intact (their group_id is set to NULL
// by the ON DELETE SET NULL foreign key), so they move to "Ungrouped".
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(groups).where(eq(groups.id, id)).run();
    res.status(204).end();
  }),
);

export default router;
