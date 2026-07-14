// One-off seed/upsert for accounts. Idempotent: for each entry, updates the
// password + role if the username already exists, otherwise inserts it. Run with:
//   cd server && npx tsx src/scripts/seed-users.ts
// Uses the same DB_PATH/.env resolution as the app (importing ./config first).
import "../config.js";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, initSchema, client } from "../db/index.js";
import { users } from "../db/schema.js";
import type { Role } from "../auth/service.js";

interface SeedUser {
  username: string;
  password: string;
  role: Role;
}

// Die Konten kommen aus dem .env (nicht mehr hartkodiert, damit keine echten
// Passwörter im Repo landen). Pro Rolle ein Paar USER/PASSWORD; ein Konto wird
// nur angelegt/aktualisiert, wenn beide Werte gesetzt sind — so lässt sich eine
// Rolle durch Weglassen der Variablen einfach überspringen.
const ROLE_ENV: { role: Role; userKey: string; passKey: string }[] = [
  { role: "admin", userKey: "PULSAR_ADMIN_USER", passKey: "PULSAR_ADMIN_PASSWORD" },
  { role: "editor", userKey: "PULSAR_EDITOR_USER", passKey: "PULSAR_EDITOR_PASSWORD" },
  { role: "user", userKey: "PULSAR_USER_USER", passKey: "PULSAR_USER_PASSWORD" },
];

const SEED: SeedUser[] = ROLE_ENV.flatMap(({ role, userKey, passKey }) => {
  const username = process.env[userKey]?.trim();
  const password = process.env[passKey];
  if (!username || !password) {
    console.log(`[seed] skip ${role}: ${userKey}/${passKey} nicht gesetzt`);
    return [];
  }
  return [{ username, password, role }];
});

async function upsert({ username, password, role }: SeedUser) {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, role })
      .where(eq(users.id, existing.id))
      .run();
    console.log(`[seed] updated  ${username} (${role})`);
  } else {
    await db.insert(users).values({ username, passwordHash, role }).run();
    console.log(`[seed] created  ${username} (${role})`);
  }
}

async function main() {
  await initSchema();
  for (const u of SEED) await upsert(u);

  const all = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .all();
  console.log("[seed] accounts now in the database:");
  for (const u of all) console.log(`  #${u.id} ${u.username} — ${u.role}`);

  client.close();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
