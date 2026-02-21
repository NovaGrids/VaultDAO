/**
 * Export utilities for CSV, JSON, and PDF reports.
 */

export type ExportFormat = 'csv' | 'json' | 'pdf';

/** Record-like row for export. */
export type ExportRow = Record<string, string | number | boolean | null | undefined>;
export type TabularRow = Record<string, unknown>;

function escapeCsvCell(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convert array of objects to CSV with headers. */
export function toCSV(rows: ExportRow[], headers?: string[]): string {
  if (rows.length === 0) {
    const h = headers ?? [];
    return h.map(escapeCsvCell).join(',') + '\r\n';
  }
  const keys = headers ?? Object.keys(rows[0] ?? {});
  const lines = [keys.map(escapeCsvCell).join(',')];
  rows.forEach((row) => {
    lines.push(keys.map((k) => escapeCsvCell(row[k])).join(','));
  });
  return lines.join('\r\n');
}

/** Convert data to pretty-printed JSON string. */
export function toJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Generate timestamped filename. */
export function timestampedFilename(
  prefix: string,
  extension: 'csv' | 'json' | 'pdf'
): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const safe = prefix.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${safe}_${ts}.${extension}`;
}

/** Filter rows by date range. Accepts ISO strings or Date objects. */
export function filterByDateRange<T extends TabularRow>(
  rows: T[],
  dateKey: string,
  start?: string | Date | null,
  end?: string | Date | null
): T[] {
  if (!start && !end) return rows;
  return rows.filter((row) => {
    const raw = row[dateKey];
    if (raw == null) return false;
    const d =
      typeof raw === 'string'
        ? new Date(raw)
        : raw instanceof Date
          ? raw
          : new Date(String(raw));
    const ms = d.getTime();
    if (Number.isNaN(ms)) return false;
    const startMs = start ? (start instanceof Date ? start : new Date(start)).getTime() : 0;
    const endMs = end ? (end instanceof Date ? end : new Date(end)).getTime() : Infinity;
    if (start && ms < startMs) return false;
    if (end && ms > endMs) return false;
    return true;
  });
}

/** Preview helper: first N rows. */
export function previewRows<T>(rows: T[], limit = 10): T[] {
  return rows.slice(0, limit);
}

/** Convert tabular data to CSV with header row. */
export function toCsv(headers: string[], rows: TabularRow[]): string {
  const headerRow = headers.map(escapeCsvCell).join(',');
  const dataRows = rows.map((row) =>
    headers.map((h) => escapeCsvCell(row[h])).join(',')
  );
  return [headerRow, ...dataRows].join('\r\n');
}

/** Download CSV from headers + rows (ExportModal API). */
export function downloadCsv(
  headers: string[],
  rows: TabularRow[],
  filename: string
): void {
  const csv = toCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert tabular data to pretty-printed JSON. */
export function toJson(headers: string[], rows: TabularRow[]): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h) => {
      obj[h] = row[h];
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

/** Download JSON from headers + rows (ExportModal API). */
export function downloadJson(
  headers: string[],
  rows: TabularRow[],
  filename: string
): void {
  const json = toJson(headers, rows);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Derive financial summary from rows with amount/token fields. */
export function deriveFinancialSummary(
  rows: TabularRow[]
): { label: string; value: string }[] {
  if (rows.length === 0) return [];
  const amountKey =
    ['amount', 'value'].find((k) => rows[0]?.[k] != null) ?? 'amount';
  const tokenKey =
    ['token', 'currency'].find((k) => rows[0]?.[k] != null) ?? 'token';

  const byToken = new Map<string, number>();
  let total = 0;

  for (const row of rows) {
    const raw = row[amountKey];
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? 0));
    if (!Number.isNaN(num)) {
      total += num;
      const token = String(row[tokenKey] ?? 'Unknown');
      byToken.set(token, (byToken.get(token) ?? 0) + num);
    }
  }

  const result: { label: string; value: string }[] = [
    { label: 'Total rows', value: String(rows.length) },
    { label: 'Total amount', value: total.toLocaleString() },
  ];
  byToken.forEach((val, token) => {
    result.push({ label: `By ${token}`, value: val.toLocaleString() });
  });
  return result;
}

/** Sanitize text for PDF (avoid zero-width chars). */
function sanitizeForPdf(text: string): string {
  return String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

/** Generate PDF report with metadata, summary, and table (ExportModal API). */
export function generatePdf(options: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: TabularRow[];
  summary?: { label: string; value: string }[];
  filename: string;
}): void {
  const { title, subtitle, headers, rows, summary, filename } = options;
  // Dynamic import to avoid blocking; jspdf-autotable augments jsPDF
  import('jspdf').then((mod) => {
    const doc = new mod.default();
    import('jspdf-autotable').then(() => {
      let y = 20;
      doc.setFontSize(18);
      doc.text(sanitizeForPdf(title), 14, y);
      y += 10;

      doc.setFontSize(10);
      doc.text(
        sanitizeForPdf(
          subtitle ?? `Generated: ${new Date().toLocaleString()}`
        ),
        14,
        y
      );
      y += 12;

      if (summary && summary.length > 0) {
        doc.setFontSize(12);
        doc.text('Summary', 14, y);
        y += 7;
        doc.setFontSize(10);
        summary.forEach((s) => {
          doc.text(
            `${sanitizeForPdf(s.label)}: ${sanitizeForPdf(s.value)}`,
            14,
            y
          );
          y += 6;
        });
        y += 5;
      }

      const bodyRows = rows.map((row) =>
        headers.map((h) => sanitizeForPdf(String(row[h] ?? '')))
      );

      (doc as unknown as { autoTable: (opts: object) => void }).autoTable({
        startY: y,
        head: [headers.map((h) => sanitizeForPdf(h))],
        body: bodyRows,
        styles: {
          fontSize: 9,
          cellPadding: 3,
          overflow: 'linebreak',
          cellWidth: 'wrap',
        },
        headStyles: {
          fillColor: [66, 139, 202],
          textColor: 255,
          fontStyle: 'bold',
        },
        alternateRowStyles: {
          fillColor: [250, 250, 250],
        },
      });

      doc.save(filename);
    });
  });
}

/** Trigger browser download of CSV (legacy: raw content). */
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger browser download of JSON. */
export function downloadJSON(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Generate PDF report (legacy async API). */
export async function generatePDF(
  vaultName: string,
  vaultAddress: string,
  dataType: string,
  headers: string[],
  rows: unknown[][],
  dateRange?: { start?: string; end?: string },
  summary?: string[]
): Promise<void> {
  const mod = await import('jspdf');
  const jsPDF = mod.default;
  await import('jspdf-autotable');

  const doc = new jsPDF();
  let yPos = 20;

  doc.setFontSize(18);
  doc.text(vaultName, 14, yPos);
  yPos += 8;

  doc.setFontSize(10);
  doc.text(`Vault: ${vaultAddress}`, 14, yPos);
  yPos += 6;
  doc.text(`Data type: ${dataType}`, 14, yPos);
  yPos += 6;
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, yPos);
  yPos += 6;

  if (dateRange?.start || dateRange?.end) {
    doc.text(
      `Date range: ${dateRange.start ?? '—'} to ${dateRange.end ?? '—'}`,
      14,
      yPos
    );
    yPos += 8;
  } else {
    yPos += 4;
  }

  if (summary && summary.length > 0) {
    doc.setFontSize(12);
    doc.text('Summary', 14, yPos);
    yPos += 6;
    doc.setFontSize(10);
    summary.forEach((line) => {
      doc.text(line, 14, yPos);
      yPos += 5;
    });
    yPos += 4;
  }

  (doc as unknown as { autoTable: (o: object) => void }).autoTable({
    startY: yPos,
    head: [headers],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [75, 85, 99], textColor: 255, fontStyle: 'bold' },
  });

  doc.save(timestampedFilename(`${vaultName}_${dataType}`, 'pdf'));
}