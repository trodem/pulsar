import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";

export type Role = "admin" | "editor" | "user";

// Erlaubte Rollen zentral, um DB-Strings (Spalte ist TEXT) sicher zu Role zu
// verengen. Alles Unbekannte fällt auf "user" (read-only) zurück.
const ROLES: readonly Role[] = ["admin", "editor", "user"];

export function normalizeRole(value: string | null | undefined): Role {
  return ROLES.includes(value as Role) ? (value as Role) : "user";
}

export interface JwtPayload {
  uid: number;
  username: string;
  role: Role;
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).all();
  return rows.length;
}

export async function createUser(
  username: string,
  password: string,
  role: Role = "admin",
) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ username, passwordHash, role })
    .returning()
    .all();
  return user;
}

export async function verifyCredentials(username: string, password: string) {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
}
