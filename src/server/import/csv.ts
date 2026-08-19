/**
 * A CSV reader, and specifically the inverse of this repository's writer.
 *
 * ── Why hand-written rather than a dependency ──────────────────────────────
 * The repo already owns the serialising half of this pair — `csvCell()` in
 * `@/server/reports/generator` — and a reader has to undo exactly what that
 * function does, including two things a general-purpose parser will not:
 *
 *   1. The UTF-8 BOM. The repo's own exports are served as `"﻿" + csv` so
 *      Excel opens them as UTF-8. Re-importing an export therefore starts with
 *      a byte that would otherwise become part of the first header's name, and
 *      `University Code` would silently fail to match.
 *
 *   2. The formula-injection guard. `csvCell` prefixes an apostrophe to any
 *      value starting `=`, `+`, `-`, `@`, tab or CR, so a spreadsheet treats it
 *      as text. A code exported as `-A1` comes back as `'-A1`. A parser that
 *      does not strip that guard imports the apostrophe as part of the
 *      identifier, and the row silently fails to match an existing record.
 *
 * Both are properties of THIS system's files. So the reader lives next to the
 * writer's rules rather than being delegated to a package that has never heard
 * of them, and the round trip is asserted in the tests.
 *
 * Everything else is plain RFC 4180: comma separators, optional double quotes,
 * `""` for a literal quote inside a quoted field, and CR, LF or CRLF line
 * endings. Newlines and commas inside quotes do not split anything.
 */

/** The apostrophe `csvCell` adds ahead of a spreadsheet-dangerous first char. */
const GUARDED = /^'[=+\-@\t\r]/;

export type CsvTable = {
  headers: string[];
  /** One entry per data row, aligned to `headers` by position. */
  rows: string[][];
  /** 1-based source line of each row, so an error can name it. */
  rowNumbers: number[];
};

export type CsvParseResult =
  | { ok: true; table: CsvTable }
  | { ok: false; reason: string };

/**
 * Splits CSV text into fields.
 *
 * A single pass with an explicit in-quotes flag, rather than a regex: a quoted
 * field may contain the delimiter and the line terminator, which is precisely
 * what a line-based split gets wrong.
 */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (quoted) {
      if (ch !== '"') {
        field += ch;
        continue;
      }
      // A doubled quote is one literal quote; a single one closes the field.
      if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      endField();
      continue;
    }
    if (ch === "\r") {
      // CRLF is one terminator, not two.
      if (text[i + 1] === "\n") i++;
      endRecord();
      continue;
    }
    if (ch === "\n") {
      endRecord();
      continue;
    }
    field += ch;
  }

  // A file that does not end in a newline still has a final record; one that
  // does must not produce a trailing empty one.
  if (field !== "" || record.length > 0) endRecord();

  return records;
}

/** Undoes `csvCell`'s guard, then trims. Order matters: the guard is outside. */
export function decodeCell(raw: string): string {
  const value = GUARDED.test(raw) ? raw.slice(1) : raw;
  return value.trim();
}

/** Blank rows are skipped rather than reported — a trailing newline is normal. */
function isBlank(record: string[]): boolean {
  return record.every((cell) => cell.trim() === "");
}

export function parseCsv(text: string): CsvParseResult {
  // Strip the BOM before anything else so it cannot end up inside header one.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === "") return { ok: false, reason: "The file is empty." };

  const records = splitRecords(body);

  const headerIndex = records.findIndex((r) => !isBlank(r));
  if (headerIndex === -1) return { ok: false, reason: "The file has no header row." };

  const headers = records[headerIndex]!.map(decodeCell);
  if (headers.every((h) => h === "")) {
    return { ok: false, reason: "The header row is blank." };
  }

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    const record = records[i]!;
    if (isBlank(record)) continue;
    // Short rows are padded and long ones kept intact: a missing trailing
    // column is a data problem for validation to report against its field, not
    // a parse failure that hides the other 9,999 rows.
    const cells = headers.map((_, c) => decodeCell(record[c] ?? ""));
    rows.push(cells);
    rowNumbers.push(i + 1); // 1-based, counting the header
  }

  if (rows.length === 0) return { ok: false, reason: "The file contains no data rows." };

  return { ok: true, table: { headers, rows, rowNumbers } };
}
