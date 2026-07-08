import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";

export interface JwtPayload {
  uid: number;
  username: string;
}

export async function countUsers(): Promise<number> {
  const rows = db.select({ id: users.id }).from(users).all();
  return rows.length;
}

export async function createUser(username: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = db
    .insert(users)
    .values({ username, passwordHash })
    .returning()
    .all();
  return user;
}

export async function verifyCredentials(username: string, password: string) {
  const user = db.select().from(users).where(eq(users.username, username)).get();
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
