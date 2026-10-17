import { describe, it, expect } from 'vitest';
import { buildReportPreviewHtml, buildPdfPreviewHtml, buildCsvPreviewHtml } from '../compliancePreview';
import { escapeHtml } from '../escapeHtml';
import type { AuditEntry } from '../auditVerification';

const PAYLOAD = '<img src=x onerror="alert(1)">';

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: '1',
    sourceEventId: 'evt-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    ledger: '100',
    contractId: 'CVAULT',
    user: 'GUSERADDRESS123456',
    action: 'proposal_created',
    details: {},
    transactionHash: 'tx-1',
    topicFingerprint: '',
    payloadDigest: '',
    ...overrides,
  } as AuditEntry;
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('renders null and undefined as empty text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('compliance preview markup', () => {
  const hostile = entry({ action: PAYLOAD, user: PAYLOAD + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });

  it('escapes entry action and user in the report preview', () => {
    const html = buildReportPreviewHtml({
      type: 'SOC2',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      sections: ['Security'],
      entries: [hostile],
    });

    expect(html).not.toContain('<img');
    expect(html).toContain(escapeHtml(PAYLOAD));
  });

  it('escapes section names and report type in the report preview', () => {
    const html = buildReportPreviewHtml({
      type: PAYLOAD,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      sections: [PAYLOAD],
      entries: [],
    });

    expect(html).not.toContain('<img');
  });

  const exportData = {
    reportType: PAYLOAD,
    vaultAddress: PAYLOAD,
    reportPeriod: { start: '2026-01-01', end: '2026-01-31' },
    complianceScore: 90,
    rules: [{ id: 'timelock', label: PAYLOAD, evaluated: 1, violations: 0, status: 'compliant' as const }],
  };

  it('escapes every interpolated value in the PDF preview', () => {
    const html = buildPdfPreviewHtml(exportData);

    expect(html).not.toContain('<img');
    expect(html).toContain(escapeHtml(PAYLOAD));
  });

  it('escapes every interpolated value in the CSV preview', () => {
    const html = buildCsvPreviewHtml(exportData);

    expect(html).not.toContain('<img');
    expect(html).toContain(escapeHtml(PAYLOAD));
  });

  it('renders the rule row and score for benign input', () => {
    const html = buildPdfPreviewHtml({
      ...exportData,
      reportType: 'SOC2',
      vaultAddress: 'CVAULT',
      rules: [{ id: 'timelock', label: 'Timelock adherence', evaluated: 2, violations: 0, status: 'compliant' }],
    });

    expect(html).toContain('Score: 90%');
    expect(html).toContain('>Timelock adherence</td>');
    expect(html).toContain('COMPLIANT');
  });

  it('shows "Not evaluated" instead of a score when no rule has data', () => {
    const html = buildPdfPreviewHtml({
      ...exportData,
      complianceScore: null,
      rules: [{ id: 'timelock', label: 'Timelock adherence', evaluated: 0, violations: 0, status: 'not_evaluated' }],
    });

    expect(html).toContain('Score: Not evaluated');
    expect(html).toContain('NOT EVALUATED');
    expect(html).not.toContain('Score: 0%');
  });
});
