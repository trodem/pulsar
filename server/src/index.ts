import { config } from "./config.js";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "./db/index.js";
import { requireAuth, requireWrite } from "./auth/middleware.js";
import authRoutes from "./routes/auth.js";
import monitorRoutes from "./routes/monitors.js";
import notificationRoutes from "./routes/notifications.js";
import groupRoutes from "./routes/groups.js";
import projectRoutes from "./routes/projects.js";
import tagRoutes from "./routes/tags.js";
import maintenanceRoutes from "./routes/maintenances.js";
import { initSocket } from "./socket.js";
import { startScheduler } from "./monitors/scheduler.js";

await initSchema();

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/monitors", requireAuth, requireWrite, monitorRoutes);
app.use("/api/notifications", requireAuth, requireWrite, notificationRoutes);
app.use("/api/groups", requireAuth, requireWrite, groupRoutes);
app.use("/api/projects", requireAuth, requireWrite, projectRoutes);
app.use("/api/tags", requireAuth, requireWrite, tagRoutes);
app.use("/api/maintenances", requireAuth, requireWrite, maintenanceRoutes);

// In production, serve the built Vue client (copied to ../public by
// scripts/deploy.ps1) and fall back to index.html for client-side routing.
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(publicDir, "index.html"));
  });
  console.log(`[server] serving client from ${publicDir}`);
}

// Catch-all error handler: forwards rejected async handlers (see asyncHandler)
// to a 500 instead of hanging the request. Must be registered after the routes.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[api] unhandled error:", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  },
);

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`[server] API + WS listening on http://localhost:${config.port}`);
  startScheduler().catch((err) =>
    console.error("[scheduler] failed to start:", err),
  );
});
