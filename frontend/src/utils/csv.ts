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
