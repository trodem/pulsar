import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "./db/index.js";
import { requireAuth } from "./auth/middleware.js";
import authRoutes from "./routes/auth.js";
import monitorRoutes from "./routes/monitors.js";
import notificationRoutes from "./routes/notifications.js";
import { initSocket } from "./socket.js";
import { startScheduler } from "./monitors/scheduler.js";

initSchema();

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/monitors", requireAuth, monitorRoutes);
app.use("/api/notifications", requireAuth, notificationRoutes);

// In production, serve the built Vue client (copied to ../public in the image)
// and fall back to index.html for client-side routing.
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(publicDir, "index.html"));
  });
  console.log(`[server] serving client from ${publicDir}`);
}

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`[server] API + WS listening on http://localhost:${config.port}`);
  startScheduler();
});
