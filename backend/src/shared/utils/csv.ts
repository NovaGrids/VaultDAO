/**
 * Shared CSV serialization for backend exports (RFC 4180 + formula neutralization).
 *
 * Mirrors frontend/src/utils/csv.ts; both are checked against the same payload
 * vectors in their tests. See docs/reference/CSV_EXPORT.md for the policy.
 */

export type CsvEol = "\n" | "\r\n";

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Prefix cells that a spreadsheet would interpret as a formula. */
export function neutralizeFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

/** Serialize one cell: neutralize formulas, then apply RFC 4180 quoting. */
export function escapeCsvCell(value: unknown): string {
  const text = neutralizeFormula(value == null ? "" : String(value));
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize one record without a line ending. */
export function csvLine(cells: ReadonlyArray<unknown>): string {
  return cells.map(escapeCsvCell).join(",");
}

/**
 * Lazily yield CSV text one record at a time (each chunk ends with `eol`).
 * Works with any iterable, so callers never need the full data set in memory.
 */
export function* csvRecords(
  records: Iterable<ReadonlyArray<unknown>>,
  eol: CsvEol = "\r\n",
): Generator<string, void, undefined> {
  for (const record of records) yield csvLine(record) + eol;
}

/** Minimal writable surface (satisfied by http.ServerResponse and Express responses). */
export interface CsvSink {
  write(chunk: string): boolean;
  once(event: "drain", listener: () => void): unknown;
}

/** Write chunks to a sink, awaiting `drain` whenever its buffer is full. */
export async function writeCsvStream(sink: CsvSink, chunks: Iterable<string>): Promise<void> {
  for (const chunk of chunks) {
    if (!sink.write(chunk)) {
      await new Promise<void>((resolve) => sink.once("drain", resolve));
    }
  }
}
