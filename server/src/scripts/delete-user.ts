// Deletes a user by username. Usage:
//   cd server && npx tsx src/scripts/delete-user.ts <username> [--yes]
// Vor dem Löschen wird immer nachgefragt; --yes / -y überspringt die Rückfrage
// (für nicht-interaktive Nutzung / Skripte).
import "../config.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { eq } from "drizzle-orm";
import { db, initSchema, client } from "../db/index.js";
import { users } from "../db/schema.js";

const args = process.argv.slice(2);
const skipConfirm = args.includes("--yes") || args.includes("-y");
// Erstes Argument, das keine Option ist, ist der Benutzername.
const usernameArg = args.find((a) => !a.startsWith("-"));
if (!usernameArg) {
  console.error("Usage: tsx src/scripts/delete-user.ts <username> [--yes]");
  process.exit(1);
}
const username: string = usernameArg;

// Fragt auf der Konsole nach und liefert nur bei ausdrücklicher Zustimmung true.
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return ["j", "ja", "y", "yes"].includes(answer);
  } finally {
    rl.close();
  }
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
    // Vor dem endgültigen Löschen immer bestätigen (außer bei --yes).
    const ok =
      skipConfirm ||
      (await confirm(
        `Benutzer "${existing.username}" (#${existing.id}, ${existing.role}) wirklich löschen? [j/N] `,
      ));
    if (!ok) {
      console.log("[delete] abgebrochen — kein Benutzer gelöscht.");
      client.close();
      return;
    }
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
