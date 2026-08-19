/**
 * A minimal RFC 4180 CSV reader.
 *
 * Written rather than installed because the job is small and the failure modes
 * are the ones real bank exports actually hit: quoted fields containing the
 * delimiter, embedded newlines inside quotes, doubled quotes as an escape, and
 * CRLF line endings. A naive `split(",")` gets all four wrong.
 *
 * Delimiter is sniffed rather than assumed — European exports are frequently
 * semicolon-separated, because comma is their decimal separator.
 */

export type CsvRow = string[];

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Pick the delimiter that yields the most consistent column count across the
 * first few lines. Counting occurrences alone would pick `,` for a
 * semicolon-separated file full of `1,50` decimals.
 */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (sample.length === 0) return ",";

  let best = ",";
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, delimiter).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // Consistency first, then width: a delimiter that splits every line into
    // the same number of columns is the structural one.
    const consistent = counts.filter((c) => c === max).length;
    const score = consistent * 100 + max;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/** Split one already-isolated line, honouring quotes. Used only for sniffing. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

export function parseCsv(text: string, delimiter?: string): CsvRow[] {
  // A BOM survives most exports and would otherwise become part of the first
  // header cell, so the column named "Account" never matches.
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? sniffDelimiter(src);

  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty final row; drop rows that are
    // entirely blank rather than handing callers phantom records.
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // Consume CRLF as one terminator.
      if (src[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (field !== "" || row.length > 0) endRow();

  return rows.map((r) => r.map((c) => c.trim()));
}

/**
 * Render rows back to a compact text table for the model to read.
 *
 * The upload is sent to Claude for column mapping rather than being matched
 * against a fixed header list, so it needs the sheet as text — but not all of
 * it: a year of rows would be tokens spent to learn a layout the first twenty
 * already show.
 */
export function toPreviewText(rows: CsvRow[], maxRows = 30): string {
  return rows
    .slice(0, maxRows)
    .map((r) => r.join(" | "))
    .join("\n");
}
