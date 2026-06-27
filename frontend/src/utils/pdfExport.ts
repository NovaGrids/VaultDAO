import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { BackendAuditEntry } from '../components/AuditLog';

/**
 * Strip HTML tags from a string, converting <br> variants to spaces
 * and decoding common HTML entities. Safe to call on plain text.
 */
export function stripHtml(value: unknown): string {
  if (value == null) return '';
  const str = String(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return str.trim();
}

interface ProposalForExport {
  id: string;
  status: string;
  proposer: string;
  recipient: string;
  amount: string;
  token?: string;
  tokenSymbol?: string;
  memo?: string;
  approvals?: number;
  threshold?: number;
  createdAt: string;
}

/**
 * Export proposal comparison to PDF
 */
export async function exportComparisonToPDF(proposals: ProposalForExport[]): Promise<void> {
  const doc = new jsPDF({
    orientation: proposals.length > 2 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Title
  doc.setFontSize(18);
  doc.setTextColor(88, 28, 135); // Purple
  doc.text('Proposal Comparison Report', 14, 15);

  // Subtitle
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated on ${new Date().toLocaleString()}`, 14, 22);
  doc.text(`Comparing ${proposals.length} proposals`, 14, 27);

  // Prepare table data
  const fields = [
    { key: 'id', label: 'ID' },
    { key: 'status', label: 'Status' },
    { key: 'proposer', label: 'Proposer' },
    { key: 'recipient', label: 'Recipient' },
    { key: 'amount', label: 'Amount' },
    { key: 'token', label: 'Token' },
    { key: 'memo', label: 'Description' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'createdAt', label: 'Created' },
  ];

  const tableData = fields.map((field) => {
    const row = [field.label];
    proposals.forEach((proposal) => {
      let value = '';
      switch (field.key) {
        case 'id':
          value = proposal.id;
          break;
        case 'status':
          value = proposal.status;
          break;
        case 'proposer':
          value = formatAddress(proposal.proposer);
          break;
        case 'recipient':
          value = formatAddress(proposal.recipient);
          break;
        case 'amount':
          value = proposal.amount;
          break;
        case 'token':
          value = proposal.tokenSymbol || proposal.token || 'XLM';
          break;
        case 'memo':
          value = proposal.memo || 'N/A';
          break;
        case 'approvals':
          value = `${proposal.approvals || 0}/${proposal.threshold || 0}`;
          break;
        case 'createdAt':
          value = new Date(proposal.createdAt).toLocaleDateString();
          break;
      }
      row.push(value);
    });
    return row;
  });

  // Add table
  (doc as any).autoTable({
    startY: 32,
    head: [['Field', ...proposals.map((p) => `Proposal #${p.id}`)]],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [88, 28, 135], // Purple
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [240, 240, 240] },
    },
    margin: { top: 32, left: 14, right: 14 },
  });

  // Add footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save PDF
  const filename = `proposal-comparison-${Date.now()}.pdf`;
  doc.save(filename);
}

/**
 * Format address for display
 */
function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

/**
 * Export audit entries to a PDF with vault contract ID and export date header.
 */
export async function exportAuditToPDF(
  entries: BackendAuditEntry[],
  contractId: string,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.setTextColor(88, 28, 135);
  doc.text('Vault Audit Log', 14, 14);

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Contract: ${contractId}`, 14, 21);
  doc.text(`Exported: ${new Date().toLocaleString()}`, 14, 26);

  (doc as unknown as { autoTable: (opts: Record<string, unknown>) => void }).autoTable({
    startY: 31,
    head: [['Timestamp', 'Action', 'Actor', 'Target', 'Tx Hash']],
    body: entries.map((e) => [
      new Date(e.timestamp).toLocaleString(),
      e.action,
      e.actor,
      e.target ?? '',
      e.txHash ?? '',
    ]),
    theme: 'grid',
    headStyles: { fillColor: [88, 28, 135], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7, textColor: [50, 50, 50] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 },
  });

  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number; pageSize: { getWidth: () => number; getHeight: () => number } } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.text(`Page ${i} of ${pageCount}`, pw / 2, ph - 8, { align: 'center' });
  }

  return doc.output('blob');
}
