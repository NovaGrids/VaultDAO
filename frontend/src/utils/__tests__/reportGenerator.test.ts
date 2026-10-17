import { describe, it, expect } from 'vitest';
import { exportToCSV } from '../reportGenerator';
import type { AuditEntry } from '../auditVerification';

/** Split one CSV record into fields, honouring quoted fields and "" escapes. */
function parseCsvRecord(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

const entry = {
  id: '1',
  sourceEventId: 'evt-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  ledger: '100',
  contractId: 'CVAULT',
  user: 'GUSER',
  action: 'proposal_created',
  details: { memo: 'pay "rent" now' },
  transactionHash: 'tx-1',
  topicFingerprint: '',
  payloadDigest: '',
} as unknown as AuditEntry;

describe('exportToCSV', () => {
  it('keeps a details value containing double quotes in a single cell', async () => {
    const csv = await exportToCSV([entry]).text();
    const [headerLine, rowLine] = csv.split('\n');
    const headers = parseCsvRecord(headerLine);
    const row = parseCsvRecord(rowLine);

    expect(row).toHaveLength(headers.length);
    expect(row[headers.indexOf('Details')]).toBe(JSON.stringify(entry.details));
  });

  it('keeps every column intact for a row with details', async () => {
    const csv = await exportToCSV([entry]).text();
    const [, rowLine] = csv.split('\n');

    expect(parseCsvRecord(rowLine)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '100',
      'CVAULT',
      'GUSER',
      'proposal_created',
      JSON.stringify(entry.details),
      'tx-1',
      'evt-1',
      '',
      '',
      '',
    ]);
  });
});
