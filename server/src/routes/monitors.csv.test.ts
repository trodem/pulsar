// Integration test for the monitor CSV export/import HTTP routes: mounts the
// real monitors router on a throwaway Express app backed by a temp SQLite file,
// then drives the endpoints over HTTP. Verifies route wiring (ordering, the text
// body parser) and that imported monitors — with their group and tags created on
// the fly — actually land in the DB, and that duplicates are skipped.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

// DB path must be set before importing the db module (it resolves at import).
const tmp = mkdtempSync(join(tmpdir(), "pulsar-csv-"));
process.env.DB_PATH = join(tmp, "test.db");

const { db, initSchema, sqlite } = await import("../db/index.js");
const { monitors, groups, tags, monitorTags } = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");
const express = (await import("express")).default;
const monitorRoutes = (await import("./monitors.js")).default;

let server: Server;
let base: string;

before(async () => {
  initSchema();
  // Seed one group + one monitor so export has something and dedup can be tested.
  const [g] = db.insert(groups).values({ name: "IBS" }).returning().all();
  db.insert(monitors)
    .values({ name: "Prisma PC", type: "http-ping", target: "http://host:8080", groupId: g.id })
    .run();

  const app = express();
  app.use(express.json());
  app.use("/api/monitors", monitorRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  sqlite.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("GET /export/monitors", () => {
  it("returns a CSV attachment with the monitors", async () => {
    const res = await fetch(`${base}/api/monitors/export/monitors`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename=/);
    const lines = (await res.text()).trim().split("\r\n");
    assert.equal(lines[0], "monitor_name,monitor_type,url,group,tag");
    assert.equal(lines[1], "Prisma PC,http-ping,http://host:8080,IBS,");
  });

  it("is not shadowed by the /:id route (route ordering)", async () => {
    const res = await fetch(`${base}/api/monitors/export/monitors`);
    assert.equal(res.status, 200);
  });
});

describe("POST /import/monitors", () => {
  async function post(csv: string) {
    return fetch(`${base}/api/monitors/import/monitors`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    });
  }

  it("imports monitors, creating the group and tags by name", async () => {
    const csv = [
      "monitor_name,monitor_type,url,group,tag",
      "Test PC 1,http-ping,http://host:8080,Typentest,M-IBS;critical",
      "Cache,tcp,cache.internal,Typentest,",
    ].join("\n");

    const res = await post(csv);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { imported: 2, skipped: 0 });

    // The monitors exist...
    const test = db.select().from(monitors).where(eq(monitors.name, "Test PC 1")).get();
    assert.ok(test);
    // ...the new group was created and linked...
    const grp = db.select().from(groups).where(eq(groups.name, "Typentest")).get();
    assert.ok(grp);
    assert.equal(test!.groupId, grp!.id);
    // ...and both tags were created and attached to Test PC 1.
    const links = db.select().from(monitorTags).where(eq(monitorTags.monitorId, test!.id)).all();
    assert.equal(links.length, 2);
    assert.equal(db.select().from(tags).all().length, 2);
  });

  it("skips monitors whose name already exists (no duplicates)", async () => {
    const csv = [
      "monitor_name,monitor_type,url,group,tag",
      "Prisma PC,http-ping,http://host:8080,IBS,", // already seeded
      "FreshOne,ping,10.0.0.9,,",
    ].join("\n");
    const res = await post(csv);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { imported: 1, skipped: 1 });
    // Only one "Prisma PC" exists — the duplicate was not inserted.
    assert.equal(db.select().from(monitors).where(eq(monitors.name, "Prisma PC")).all().length, 1);
  });

  it("reuses an existing tag instead of duplicating it", async () => {
    const before = db.select().from(tags).all().length;
    const res = await post(
      "monitor_name,monitor_type,url,group,tag\nWithSharedTag,ping,10.0.0.5,,M-IBS",
    );
    assert.equal(res.status, 200);
    // "M-IBS" already exists from the first import — no new tag row.
    assert.equal(db.select().from(tags).all().length, before);
  });

  it("rejects a malformed file with a clear 400 error", async () => {
    const res = await post("monitor_name,monitor_type,url\nBad,gopher,x");
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /invalid monitor_type/);
  });

  it("rejects an empty file with a clear 400 error", async () => {
    const res = await post("");
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /empty/i);
  });

  it("rejects a file missing a required column", async () => {
    const res = await post("monitor_name,monitor_type\nX,http");
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Missing required column/);
  });
});
