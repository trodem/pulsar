import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { tags } from "../db/schema.js";

const router = Router();

const tagSchema = z.object({
  name: z.string().min(1).max(60),
  // Hex color like "#4f9dff".
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #rrggbb hex value")
    .default("#4f9dff"),
});

router.get("/", (_req, res) => {
  const all = db.select().from(tags).orderBy(asc(tags.name)).all();
  res.json(all);
});

router.post("/", (req, res) => {
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  try {
    const [created] = db.insert(tags).values(parsed.data).returning().all();
    res.status(201).json(created);
  } catch (err) {
    res.status(409).json({ error: duplicateOr(err, "Tag name already exists") });
  }
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  try {
    const [updated] = db
      .update(tags)
      .set(parsed.data)
      .where(eq(tags.id, id))
      .returning()
      .all();
    if (!updated) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(409).json({ error: duplicateOr(err, "Tag name already exists") });
  }
});

// Deleting a tag also removes its monitor_tags links (ON DELETE CASCADE).
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.delete(tags).where(eq(tags.id, id)).run();
  res.status(204).end();
});

// Turns a UNIQUE-constraint violation into a friendly message, rethrows others.
function duplicateOr(err: unknown, message: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/i.test(msg)) return message;
  throw err;
}

export default router;
