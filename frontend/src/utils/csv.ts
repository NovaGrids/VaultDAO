/**
 * Shared CSV serialization for every export path.
 *
 * - RFC 4180 quoting: cells containing a comma, double quote, CR or LF are
 *   wrapped in double quotes, with embedded quotes doubled.
 * - Formula neutralization: cells starting with = + - @ tab or CR are
 *   prefixed with a single quote so spreadsheets read them as text instead
 *   of executing them.
 */

export type CsvEol = '\n' | '\r\n';

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Prefix cells that a spreadsheet would interpret as a formula. */
export function neutralizeFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

/** Serialize one cell: neutralize formulas, then apply RFC 4180 quoting. */
export function escapeCsvCell(value: unknown): string {
  const text = neutralizeFormula(value == null ? '' : String(value));
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize one record (a row of cells) without a line ending. */
export function csvLine(cells: ReadonlyArray<unknown>): string {
  return cells.map(escapeCsvCell).join(',');
}

/** Serialize a list of array records, the first of which may be a header row. */
export function toCsvFromArrays(records: ReadonlyArray<ReadonlyArray<unknown>>, eol: CsvEol = '\r\n'): string {
  return records.map(csvLine).join(eol);
}

/** Serialize object rows, reading each column by its header name. */
export function toCsv(headers: ReadonlyArray<string>, rows: ReadonlyArray<object>, eol: CsvEol = '\r\n'): string {
  const records = rows.map(row => headers.map(h => (row as Record<string, unknown>)[h]));
  return toCsvFromArrays([headers, ...records], eol);
}

/** UTF-8 byte order mark. Opt-in: Excel needs it to detect UTF-8, other tools show it as stray text. */
export const CSV_BOM = '﻿';

/** MIME type for CSV downloads; the charset is always UTF-8. */
export const CSV_MIME_TYPE = 'text/csv;charset=utf-8';

/**
 * Lazily yield CSV text one record at a time (each chunk ends with `eol`).
 * Accepts any iterable, so large exports never build one giant string.
 */
export function* csvRecords(
  records: Iterable<ReadonlyArray<unknown>>,
  eol: CsvEol = '\r\n'
): Generator<string, void, undefined> {
  for (const record of records) yield csvLine(record) + eol;
}

/**
 * Build a CSV Blob from record chunks. Chunks are grouped into parts of
 * `partSize` records so the browser can spill them to disk instead of the
 * caller holding the whole file as a single string.
 */
export function csvToBlob(
  records: Iterable<ReadonlyArray<unknown>>,
  options: { eol?: CsvEol; bom?: boolean; partSize?: number } = {}
): Blob {
  const { eol = '\r\n', bom = false, partSize = 1000 } = options;
  const parts: string[] = bom ? [CSV_BOM] : [];
  let batch: string[] = [];
  for (const chunk of csvRecords(records, eol)) {
    batch.push(chunk);
    if (batch.length >= partSize) {
      parts.push(batch.join(''));
      batch = [];
    }
  }
  if (batch.length > 0) parts.push(batch.join(''));
  return new Blob(parts, { type: CSV_MIME_TYPE });
}
