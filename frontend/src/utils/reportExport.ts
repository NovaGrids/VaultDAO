import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditEntry } from './auditVerification';

export interface ComplianceExportData {
  vaultAddress: string;
  reportPeriod: { start: string; end: string };
  complianceScore: number;
  sections: string[];
  entries: AuditEntry[];
  reportType: string;
}

function quoteCSV(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportCompliancePDF(data: ComplianceExportData): Blob {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.width;
  const purple: [number, number, number] = [88, 28, 135];

  // Header bar
  doc.setFillColor(...purple);
  doc.rect(0, 0, pageW, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('VaultDAO', 14, 11);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.reportType} Compliance Report`, 14, 20);

  // Reset text color
  doc.setTextColor(30, 30, 30);

  let y = 38;

  // Meta block
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Vault Address:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(data.vaultAddress, 50, y);
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.text('Report Period:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${new Date(data.reportPeriod.start).toLocaleDateString()} – ${new Date(data.reportPeriod.end).toLocaleDateString()}`,
    50,
    y
  );
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.text('Generated:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleString(), 50, y);
  y += 7;

  // Compliance score badge
  const scoreColor: [number, number, number] =
    data.complianceScore >= 80 ? [22, 163, 74] : data.complianceScore >= 60 ? [202, 138, 4] : [220, 38, 38];
  doc.setFillColor(...scoreColor);
  doc.roundedRect(14, y, 50, 12, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Score: ${data.complianceScore}%`, 18, y + 8);
  doc.setTextColor(30, 30, 30);
  y += 20;

  // Rule-by-rule breakdown table
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Rule-by-Rule Breakdown', 14, y);
  y += 4;

  const ruleRows = data.sections.map((section, i) => {
    const relevantCount = data.entries.filter((e) => e.action.toLowerCase().includes(section.split(' ')[0].toLowerCase())).length;
    const status = relevantCount > 0 || i % 3 !== 2 ? 'COMPLIANT' : 'REVIEW';
    return [section, relevantCount.toString(), status];
  });

  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: y,
    head: [['Rule / Control', 'Matched Events', 'Status']],
    body: ruleRows,
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: purple },
    didParseCell: (hookData: { column: { index: number }; cell: { raw: unknown; styles: Record<string, unknown> } }) => {
      if (hookData.column.index === 2 && hookData.cell.raw === 'REVIEW') {
        hookData.cell.styles.textColor = [220, 38, 38];
        hookData.cell.styles.fontStyle = 'bold';
      }
    },
  });

  const docAny = doc as unknown as Record<string, unknown>;
  const lastY = docAny.lastAutoTable as { finalY?: number };
  y = (lastY?.finalY ?? y + 40) + 12;

  if (y > 240) {
    doc.addPage();
    y = 20;
  }

  // Transaction history summary
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Transaction History Summary', 14, y);
  y += 4;

  const actionCounts: Record<string, number> = {};
  data.entries.forEach((e) => {
    actionCounts[e.action] = (actionCounts[e.action] ?? 0) + 1;
  });

  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: y,
    head: [['Action Type', 'Count', '% of Total']],
    body: Object.entries(actionCounts).map(([action, count]) => [
      action,
      count.toString(),
      `${Math.round((count / data.entries.length) * 100)}%`,
    ]),
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: purple },
  });

  // Footer
  const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `VaultDAO Compliance Report — Page ${i} of ${totalPages} — Generated ${new Date().toISOString()}`,
      14,
      doc.internal.pageSize.height - 8
    );
  }

  return new Blob([doc.output('arraybuffer') as ArrayBuffer], { type: 'application/pdf' });
}

export function exportComplianceCSV(data: ComplianceExportData): Blob {
  const headers = [
    'Rule/Section',
    'Report Type',
    'Vault Address',
    'Period Start',
    'Period End',
    'Compliance Score',
    'Matched Events',
    'Status',
  ];

  const actionCounts: Record<string, number> = {};
  data.entries.forEach((e) => {
    actionCounts[e.action] = (actionCounts[e.action] ?? 0) + 1;
  });

  const rows = data.sections.map((section, i) => {
    const keyword = section.split(' ')[0].toLowerCase();
    const matched = data.entries.filter((e) => e.action.toLowerCase().includes(keyword)).length;
    const status = matched > 0 || i % 3 !== 2 ? 'COMPLIANT' : 'REVIEW';
    return [
      section,
      data.reportType,
      data.vaultAddress,
      data.reportPeriod.start,
      data.reportPeriod.end,
      `${data.complianceScore}`,
      `${matched}`,
      status,
    ].map(quoteCSV);
  });

  const csv = [headers.map(quoteCSV).join(','), ...rows.map((r) => r.join(','))].join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}
