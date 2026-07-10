import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CsvError,
  CSV_HEADER,
  monitorsToCsv,
  parseMonitorsCsv,
  type MonitorCsv,
} from "./csv.js";

const SAMPLE: MonitorCsv = {
  name: "Prisma PC",
  type: "http-ping",
  target: "http://star0007110054m.stadlerrail.ch:8080",
  group: "IBS",
  tags: ["M-IBS"],
};

describe("monitorsToCsv (export)", () => {
  it("exports valid data with the expected header and columns", () => {
    const csv = monitorsToCsv([
      SAMPLE,
      {
        name: "Test PC 1",
        type: "http-ping",
        target: "http://star0007110054m.stadlerrail.ch:8080",
        group: "Typentest",
        tags: [],
      },
    ]);
    const lines = csv.trimEnd().split("\r\n");

    assert.equal(lines[0], "monitor_name,monitor_type,url,group,tag");
    assert.equal(
      lines[1],
      "Prisma PC,http-ping,http://star0007110054m.stadlerrail.ch:8080,IBS,M-IBS",
    );
    // Empty tag column when the monitor has no tags.
    assert.equal(
      lines[2],
      "Test PC 1,http-ping,http://star0007110054m.stadlerrail.ch:8080,Typentest,",
    );
  });

  it("joins multiple tags with a semicolon", () => {
    const csv = monitorsToCsv([{ ...SAMPLE, tags: ["M-IBS", "critical"] }]);
    assert.ok(csv.trimEnd().split("\r\n")[1].endsWith(",IBS,M-IBS;critical"));
  });

  it("quotes fields containing commas, quotes or newlines (RFC 4180)", () => {
    const csv = monitorsToCsv([
      { ...SAMPLE, name: 'Web, "prod"', group: "East, US" },
    ]);
    const dataLine = csv.trimEnd().split("\r\n")[1];
    assert.ok(dataLine.startsWith('"Web, ""prod""",http-ping,'));
    assert.ok(dataLine.includes('"East, US"'));
  });

  it("round-trips through the parser", () => {
    const parsed = parseMonitorsCsv(monitorsToCsv([SAMPLE]));
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0], SAMPLE);
  });
});

describe("parseMonitorsCsv (import)", () => {
  it("parses a correct file into insertable rows", () => {
    const csv = [
      "monitor_name,monitor_type,url,group,tag",
      "Prisma PC,http-ping,http://star0007110054m.stadlerrail.ch:8080,IBS,M-IBS",
      "Test PC 1,http-ping,http://star0007110054m.stadlerrail.ch:8080,Typentest,",
    ].join("\n");

    const rows = parseMonitorsCsv(csv);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], SAMPLE);
    assert.equal(rows[1].group, "Typentest");
    assert.deepEqual(rows[1].tags, []);
  });

  it("auto-detects a TAB-separated file (pasted from Excel)", () => {
    const csv = [
      "monitor_name\tmonitor_type\turl\tgroup\ttag",
      "Prisma PC\thttp-ping\thttp://host:8080\tIBS\tM-IBS",
    ].join("\n");
    const rows = parseMonitorsCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Prisma PC");
    assert.equal(rows[0].group, "IBS");
    assert.deepEqual(rows[0].tags, ["M-IBS"]);
  });

  it("splits multiple tags on a semicolon", () => {
    const csv = [
      "monitor_name,monitor_type,url,group,tag",
      "Host,ping,10.0.0.1,,a;b;c",
    ].join("\n");
    assert.deepEqual(parseMonitorsCsv(csv)[0].tags, ["a", "b", "c"]);
  });

  it("treats a blank group as ungrouped", () => {
    const csv = ["monitor_name,monitor_type,url,group,tag", "Host,ping,10.0.0.1,,"].join("\n");
    assert.equal(parseMonitorsCsv(csv)[0].group, null);
  });

  it("accepts columns in any order and ignores unknown extra columns", () => {
    const csv = ["extra,url,monitor_type,monitor_name", "junk,10.0.0.1,ping,Host"].join("\n");
    const rows = parseMonitorsCsv(csv);
    assert.equal(rows[0].name, "Host");
    assert.equal(rows[0].type, "ping");
    assert.equal(rows[0].target, "10.0.0.1");
  });

  it("tolerates a UTF-8 BOM and CRLF line endings", () => {
    const csv = "﻿monitor_name,monitor_type,url\r\nAPI,http,https://x.com\r\n";
    const rows = parseMonitorsCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "API");
  });

  describe("malformed files raise a clear CsvError", () => {
    it("rejects a missing required column", () => {
      const csv = ["monitor_name,monitor_type", "API,http"].join("\n");
      assert.throws(() => parseMonitorsCsv(csv), (e: Error) => {
        assert.ok(e instanceof CsvError);
        assert.match(e.message, /Missing required column/);
        assert.match(e.message, /url/);
        return true;
      });
    });

    it("rejects an unknown monitor_type with the row number", () => {
      const csv = ["monitor_name,monitor_type,url", "API,gopher,x"].join("\n");
      assert.throws(() => parseMonitorsCsv(csv), (e: Error) => {
        assert.ok(e instanceof CsvError);
        assert.match(e.message, /Row 2/);
        assert.match(e.message, /invalid monitor_type/);
        return true;
      });
    });

    it("rejects an empty monitor_name", () => {
      const csv = ["monitor_name,monitor_type,url", ",http,x"].join("\n");
      assert.throws(
        () => parseMonitorsCsv(csv),
        (e: Error) => e instanceof CsvError && /monitor_name is required/.test(e.message),
      );
    });

    it("rejects an empty url", () => {
      const csv = ["monitor_name,monitor_type,url", "API,http,"].join("\n");
      assert.throws(
        () => parseMonitorsCsv(csv),
        (e: Error) => e instanceof CsvError && /url is required/.test(e.message),
      );
    });
  });

  describe("empty files raise a clear CsvError", () => {
    it("rejects a fully empty file", () => {
      assert.throws(() => parseMonitorsCsv(""), (e: Error) => {
        assert.ok(e instanceof CsvError);
        assert.match(e.message, /empty/i);
        return true;
      });
    });

    it("rejects a whitespace-only file", () => {
      assert.throws(
        () => parseMonitorsCsv("   \n  \r\n"),
        (e: Error) => e instanceof CsvError && /empty/i.test(e.message),
      );
    });

    it("rejects a header-only file (no data rows)", () => {
      assert.throws(() => parseMonitorsCsv("monitor_name,monitor_type,url\n"), (e: Error) => {
        assert.ok(e instanceof CsvError);
        assert.match(e.message, /no data rows/);
        return true;
      });
    });
  });
});
