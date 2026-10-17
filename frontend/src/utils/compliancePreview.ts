import type { AuditEntry } from './auditVerification';
import { escapeHtml } from './escapeHtml';
import { RULE_STATUS_LABEL, type RuleResult } from './complianceRules';

/**
 * Preview markup for the compliance report screen.
 *
 * Every value taken from audit entries, configuration or the vault is passed
 * through escapeHtml before it is interpolated, because the result is rendered
 * with dangerouslySetInnerHTML in the app origin.
 */

export interface ReportPreviewConfig {
  type: string;
  startDate: string;
  endDate: string;
  sections: string[];
  entries: AuditEntry[];
}

export interface ComplianceExportPreviewData {
  reportType: string;
  vaultAddress: string;
  reportPeriod: { start: string; end: string };
  /** null when no rule had data to evaluate */
  complianceScore: number | null;
  rules: RuleResult[];
}

export function buildReportPreviewHtml(config: ReportPreviewConfig): string {
  const { entries } = config;
  return `
        <div style="padding: 20px; background: #1a1a1a; color: white; font-family: Arial, sans-serif;">
          <h1 style="color: #a855f7;">${escapeHtml(config.type)} Compliance Report</h1>
          <p><strong>Period:</strong> ${escapeHtml(new Date(config.startDate).toLocaleDateString())} - ${escapeHtml(new Date(config.endDate).toLocaleDateString())}</p>
          <p><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</p>

          <h2 style="margin-top: 30px;">Report Summary</h2>
          <ul>
            <li>Total Audit Entries: ${entries.length}</li>
            <li>Unique Users: ${new Set(entries.map(e => e.user)).size}</li>
            <li>Action Types: ${new Set(entries.map(e => e.action)).size}</li>
          </ul>

          <h2 style="margin-top: 30px;">Selected Sections</h2>
          <ul>
            ${config.sections.map(section => `<li>${escapeHtml(section)}</li>`).join('')}
          </ul>

          <h2 style="margin-top: 30px;">Recent Activities (Sample)</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <thead>
              <tr style="background: #2a2a2a; border-bottom: 2px solid #a855f7;">
                <th style="padding: 10px; text-align: left;">Timestamp</th>
                <th style="padding: 10px; text-align: left;">User</th>
                <th style="padding: 10px; text-align: left;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${entries.slice(0, 10).map(entry => `
                <tr style="border-bottom: 1px solid #333;">
                  <td style="padding: 10px;">${escapeHtml(new Date(entry.timestamp).toLocaleString())}</td>
                  <td style="padding: 10px; font-family: monospace;">${escapeHtml(`${entry.user.slice(0, 8)}...${entry.user.slice(-6)}`)}</td>
                  <td style="padding: 10px;">${escapeHtml(entry.action)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <p style="margin-top: 30px; color: #999; font-size: 12px;">
            This is a preview. Download the full PDF report for complete details and compliance documentation.
          </p>
        </div>
      `;
}

function scoreColor(score: number | null): string {
  if (score === null) return '#525252';
  return score >= 80 ? '#166534' : score >= 60 ? '#854d0e' : '#7f1d1d';
}

function scoreLabel(score: number | null): string {
  return score === null ? 'Not evaluated' : `${score}%`;
}

export function buildPdfPreviewHtml(data: ComplianceExportPreviewData): string {
  const previewRows = data.rules
    .map((r) => {
      const statusColor = r.status === 'compliant' ? '#4ade80' : r.status === 'review' ? '#f87171' : '#a3a3a3';
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #333">${escapeHtml(r.label)}</td><td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center">${r.evaluated}</td><td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center">${r.violations}</td><td style="padding:6px 10px;border-bottom:1px solid #333;color:${statusColor};font-weight:600">${escapeHtml(RULE_STATUS_LABEL[r.status])}</td></tr>`;
    })
    .join('');
  return `
        <div style="padding:20px;font-family:Arial,sans-serif;background:#1a1a1a;color:#fff">
          <div style="background:#581c87;padding:14px 20px;border-radius:8px;margin-bottom:16px">
            <div style="font-size:18px;font-weight:bold">VaultDAO</div>
            <div style="font-size:12px;opacity:.8">${escapeHtml(data.reportType)} Compliance Report — PDF Preview</div>
          </div>
          <p><strong>Vault:</strong> <code style="font-size:11px">${escapeHtml(data.vaultAddress)}</code></p>
          <p><strong>Period:</strong> ${escapeHtml(new Date(data.reportPeriod.start).toLocaleDateString())} – ${escapeHtml(new Date(data.reportPeriod.end).toLocaleDateString())}</p>
          <div style="display:inline-block;background:${scoreColor(data.complianceScore)};padding:4px 14px;border-radius:20px;font-weight:bold;margin-bottom:16px">Score: ${escapeHtml(scoreLabel(data.complianceScore))}</div>
          <table style="width:100%;border-collapse:collapse;margin-top:8px">
            <thead><tr style="background:#2a2a2a"><th style="padding:8px 10px;text-align:left">Rule</th><th style="padding:8px 10px">Events Evaluated</th><th style="padding:8px 10px">Violations</th><th style="padding:8px 10px">Status</th></tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
          <p style="color:#999;font-size:11px;margin-top:16px">This is a preview. Only the rules listed are evaluated; a rule with no matching audit events is reported as not evaluated. Click "Download PDF" to save the full formatted report.</p>
        </div>`;
}

export function buildCsvPreviewHtml(data: ComplianceExportPreviewData): string {
  const headers = ['Rule', 'Report Type', 'Vault Address', 'Period Start', 'Period End', 'Compliance Score', 'Events Evaluated', 'Violations', 'Status'];
  const rows = data.rules.map((r) => [
    r.label,
    data.reportType,
    data.vaultAddress.slice(0, 12) + '…',
    data.reportPeriod.start,
    data.reportPeriod.end,
    scoreLabel(data.complianceScore),
    String(r.evaluated),
    String(r.violations),
    RULE_STATUS_LABEL[r.status],
  ]);
  const headerHtml = headers.map((h) => `<th style="padding:6px 10px;background:#2a2a2a;border-bottom:2px solid #581c87;text-align:left">${escapeHtml(h)}</th>`).join('');
  const rowsHtml = rows.map((r) => `<tr>${r.map((c, ci) => `<td style="padding:5px 10px;border-bottom:1px solid #333;${ci === 8 ? `color:${c === RULE_STATUS_LABEL.compliant ? '#4ade80' : c === RULE_STATUS_LABEL.review ? '#f87171' : '#a3a3a3'};font-weight:600` : ''}">${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `
        <div style="padding:20px;font-family:Arial,sans-serif;background:#1a1a1a;color:#fff">
          <h3 style="color:#a855f7;margin-bottom:12px">${escapeHtml(data.reportType)} CSV Preview</h3>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
          <p style="color:#999;font-size:11px;margin-top:12px">Click "Download CSV" to save the full export.</p>
        </div>`;
}
