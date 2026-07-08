import { Router } from "express";
import { z } from "zod";
import {
  countUsers,
  createUser,
  signToken,
  verifyCredentials,
} from "../auth/service.js";

const router = Router();

const credentialsSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6).max(200),
});

// Tells the client whether initial admin setup is still required.
router.get("/status", async (_req, res) => {
  const users = await countUsers();
  res.json({ needsSetup: users === 0 });
});

// First-run: create the single admin account. Disabled once one exists.
router.post("/setup", async (req, res) => {
  if ((await countUsers()) > 0) {
    res.status(403).json({ error: "Setup already completed" });
    return;
  }
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid username or password (min 6 chars)" });
    return;
  }
  const user = await createUser(parsed.data.username, parsed.data.password);
  const token = signToken({ uid: user.id, username: user.username });
  res.json({ token, username: user.username });
});

router.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid credentials" });
    return;
  }
  const user = await verifyCredentials(parsed.data.username, parsed.data.password);
  if (!user) {
    res.status(401).json({ error: "Wrong username or password" });
    return;
  }
  const token = signToken({ uid: user.id, username: user.username });
  res.json({ token, username: user.username });
});

export default router;
