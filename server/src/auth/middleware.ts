import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "./service.js";

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing authentication token" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = payload;
  next();
}

// Read-only guard: `user`-role accounts may only issue safe (read) requests.
// Any mutating method is rejected with 403. Mount after requireAuth so req.user
// is populated. Because it keys off the HTTP method rather than a per-route
// allow-list, it also covers action POSTs (e.g. restart-program) and any route
// added later. Note: this makes GET the read boundary, so http-ping's
// "Check users"/"Restart" (both POST) are admin-only.
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireWrite(req: Request, res: Response, next: NextFunction) {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Read-only account: action not permitted" });
    return;
  }
  next();
}
