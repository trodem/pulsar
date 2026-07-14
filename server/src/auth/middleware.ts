import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload, type Role } from "./service.js";

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

// Schreib-Guard als Factory: safe (read) Methoden gehen für jeden durch, jede
// mutierende Methode nur für die übergebenen Rollen (Default: nur "admin").
// Nach requireAuth mounten, damit req.user gesetzt ist. Da der Guard auf die
// HTTP-Methode statt auf eine Route-Allow-List prüft, deckt er auch Action-POSTs
// (z. B. restart-program) und später ergänzte Routen ab. Heißt: GET ist die
// Lese-Grenze, http-pings "Check users"/"Restart" (beide POST) bleiben gated.
//
// Beispiel: requireWrite() → nur admin; requireWrite("admin", "editor") → beide.
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireWrite(...allowedRoles: Role[]) {
  const roles = allowedRoles.length ? allowedRoles : (["admin"] as Role[]);
  return function requireWriteGuard(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (READ_METHODS.has(req.method)) {
      next();
      return;
    }
    if (!req.user || !roles.includes(req.user.role)) {
      res
        .status(403)
        .json({ error: "Read-only account: action not permitted" });
      return;
    }
    next();
  };
}
