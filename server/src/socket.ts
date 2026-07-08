import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import { config } from "./config.js";
import { bus } from "./events.js";
import { verifyToken } from "./auth/service.js";

export function initSocket(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
  });

  // Authenticate the socket handshake with the same JWT as the REST API.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.user = payload;
    next();
  });

  io.on("connection", (socket) => {
    socket.emit("ready", { user: socket.data.user });
  });

  // Forward scheduler heartbeats to all connected (authenticated) clients.
  bus.onEvent("heartbeat", (payload) => {
    io.emit("heartbeat", payload);
  });

  // Forward STAP logged-user updates.
  bus.onEvent("monitor:users", (payload) => {
    io.emit("monitor:users", payload);
  });

  return io;
}
