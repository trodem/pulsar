// CSV export/import of monitors with their group and tags. Kept as pure
// functions (no DB access) so both the routes and the unit tests can exercise
// them.
//
// The file has exactly these columns:
//   monitor_name, monitor_type, url, group, tag
// - group : the monitor's group name (blank = ungrouped).
// - tag   : the monitor's tag name(s). A monitor with several tags lists them
//           separated by a semicolon (";") so the field delimiter stays free.
//
// Format conventions (chosen as the most common, unambiguous standards):
//   - Export delimiter: comma (",") — RFC 4180. Import auto-detects comma or TAB
//     from the header, so a file pasted/saved from Excel as TSV also works.
//   - Line ending on export: CRLF ("\r\n"); the parser accepts LF too.
//   - Text quoting: RFC 4180 — fields containing the delimiter, a quote or a
//     newline are wrapped in double quotes and inner quotes are doubled.

// The exact header row we write, and the columns we require on import. Extra
// columns in an imported file are ignored; the three required ones must exist.
export const CSV_HEADER = [
  "monitor_name",
  "monitor_type",
  "url",
  "group",
  "tag",
] as const;

const REQUIRED_COLUMNS = ["monitor_name", "monitor_type", "url"] as const;

const MONITOR_TYPES = ["http", "tcp", "ping", "http-ping"] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

// Separator for the tag names inside the single "tag" field.
const TAG_SEPARATOR = ";";

// A monitor flattened for CSV: `group` is the group name (null = ungrouped) and
// `tags` is the list of tag names.
export interface MonitorCsv {
  name: string;
  type: MonitorType;
  target: string;
  group: string | null;
  tags: string[];
}

// Thrown for any format problem so callers can surface a clear 400 message.
export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

// --- Export -------------------------------------------------------------

function escapeField(value: string, delimiter: string): string {
  // RFC 4180: quote when the value contains the delimiter, a quote, CR or LF.
  if (value.includes(delimiter) || /["\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Serializes monitors to an RFC 4180 CSV string (header + one row each).
export function monitorsToCsv(rows: MonitorCsv[]): string {
  const d = ",";
  const lines: string[] = [CSV_HEADER.join(d)];
  for (const r of rows) {
    const fields = [
      r.name,
      r.type,
      r.target,
      r.group ?? "",
      r.tags.join(TAG_SEPARATOR),
    ];
    lines.push(fields.map((f) => escapeField(f, d)).join(d));
  }
  // Trailing CRLF so the file ends on a newline (common convention).
  return lines.join("\r\n") + "\r\n";
}

// --- Import -------------------------------------------------------------

// Picks the field delimiter by counting candidates in the header line. Comma
// wins ties (and the all-zero single-column case). Lets a TSV pasted from Excel
// import without the user re-saving it as comma-separated.
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

// Parses one RFC 4180 record starting at `text[pos]`, returning the field
// values and the index just past the consumed line terminator (or EOF).
function parseRecord(
  text: string,
  pos: number,
  delimiter: string,
): { fields: string[]; next: number } {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = pos;

  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      fields.push(field);
      field = "";
    } else if (c === "\n") {
      fields.push(field);
      return { fields, next: i + 1 };
    } else if (c === "\r") {
      fields.push(field);
      // Consume the paired LF of a CRLF terminator, if present.
      return { fields, next: text[i + 1] === "\n" ? i + 2 : i + 1 };
    } else {
      field += c;
    }
  }
  fields.push(field);
  return { fields, next: i };
}

// Splits CSV text into records (arrays of field strings), skipping a trailing
// empty line. Handles quoted fields containing the delimiter and newlines.
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let pos = 0;
  while (pos < text.length) {
    const { fields, next } = parseRecord(text, pos, delimiter);
    records.push(fields);
    pos = next;
  }
  // A trailing newline produces a final empty record — drop it.
  if (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === "") records.pop();
  }
  return records;
}

// Parses & validates a monitors CSV, returning the rows ready to create.
// Throws CsvError with a clear, row-numbered message on any format problem.
export function parseMonitorsCsv(text: string): MonitorCsv[] {
  // Strip a UTF-8 BOM some spreadsheet tools prepend.
  const body = text.replace(/^﻿/, "");
  if (body.trim() === "") {
    throw new CsvError("The CSV file is empty.");
  }

  const delimiter = detectDelimiter(body);
  const records = parseRecords(body, delimiter);
  if (records.length === 0) {
    throw new CsvError("The CSV file is empty.");
  }

  const header = records[0].map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  header.forEach((name, idx) => {
    if (!(name in col)) col[name] = idx;
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !(c in col));
  if (missing.length > 0) {
    throw new CsvError(
      `Missing required column(s): ${missing.join(", ")}. Expected header: ${CSV_HEADER.join(", ")}.`,
    );
  }

  if (records.length === 1) {
    throw new CsvError("The CSV file has a header but no data rows.");
  }

  const at = (fields: string[], name: string): string =>
    col[name] != null ? (fields[col[name]] ?? "") : "";

  const rows: MonitorCsv[] = [];
  for (let r = 1; r < records.length; r++) {
    const fields = records[r];
    const line = r + 1; // 1-based line number as seen in a text editor

    const name = at(fields, "monitor_name").trim();
    if (name === "") {
      throw new CsvError(`Row ${line}: monitor_name is required.`);
    }

    const type = at(fields, "monitor_type").trim() as MonitorType;
    if (!MONITOR_TYPES.includes(type)) {
      throw new CsvError(
        `Row ${line}: invalid monitor_type "${type}" (expected one of ${MONITOR_TYPES.join(", ")}).`,
      );
    }

    const target = at(fields, "url").trim();
    if (target === "") {
      throw new CsvError(`Row ${line}: url is required.`);
    }

    const groupRaw = at(fields, "group").trim();
    const tags = at(fields, "tag")
      .split(TAG_SEPARATOR)
      .map((t) => t.trim())
      .filter((t) => t !== "");

    rows.push({
      name,
      type,
      target,
      group: groupRaw === "" ? null : groupRaw,
      tags,
    });
  }

  return rows;
}
