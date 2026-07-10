// Deletes a user by username. Usage:
//   cd server && npx tsx src/scripts/delete-user.ts <username>
import "../config.js";
import { eq } from "drizzle-orm";
import { db, initSchema, client } from "../db/index.js";
import { users } from "../db/schema.js";

const username = process.argv[2];
if (!username) {
  console.error("Usage: tsx src/scripts/delete-user.ts <username>");
  process.exit(1);
}

async function main() {
  await initSchema();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!existing) {
    console.log(`[delete] no user named "${username}"`);
  } else {
    await db.delete(users).where(eq(users.id, existing.id)).run();
    console.log(`[delete] removed ${username} (#${existing.id})`);
  }

  const all = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .all();
  console.log("[delete] accounts now in the database:");
  for (const u of all) console.log(`  #${u.id} ${u.username} — ${u.role}`);

  client.close();
}

main().catch((err) => {
  console.error("[delete] failed:", err);
  process.exit(1);
});
