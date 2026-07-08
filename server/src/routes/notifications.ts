import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { notifications } from "../db/schema.js";
import { testNotification } from "../notifications/index.js";

const router = Router();

const notificationSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["webhook", "telegram"]),
  config: z.record(z.string(), z.any()).default({}),
  active: z.boolean().default(true),
});

router.get("/", (_req, res) => {
  const all = db.select().from(notifications).all();
  res.json(
    all.map((n) => ({
      ...n,
      config: safeParse(n.config),
    })),
  );
});

router.post("/", (req, res) => {
  const parsed = notificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const [created] = db
    .insert(notifications)
    .values({
      name: parsed.data.name,
      type: parsed.data.type,
      config: JSON.stringify(parsed.data.config),
      active: parsed.data.active,
    })
    .returning()
    .all();
  res.status(201).json({ ...created, config: safeParse(created.config) });
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = notificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const [updated] = db
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
  res.json({ ...updated, config: safeParse(updated.config) });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.delete(notifications).where(eq(notifications.id, id)).run();
  res.status(204).end();
});

// Send a test message using a provided (unsaved) config.
router.post("/test", async (req, res) => {
  const schema = z.object({
    type: z.enum(["webhook", "telegram"]),
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
