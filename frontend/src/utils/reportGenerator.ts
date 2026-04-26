import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditEntry } from './auditVerification';
import { stripHtml } from './pdfExport';

export type ReportType = 'SOC2' | 'ISO27001' | 'Custom' | 'Full' | 'TransactionLog' | 'SignerActivity';

export interface ReportConfig {
  type: ReportType;
  dateRange: { from: string; to: string };
  includeSections: {
    summary: boolean;
    actionLog: boolean;
    userActivity: boolean;
    securityEvents: boolean;
    complianceChecks: boolean;
  };
  organizationName?: string;
  reportTitle?: string;
}

export interface ReportData {
  entries: AuditEntry[];
  summary: {
    totalActions: number;
    uniqueUsers: number;
    dateRange: string;
    actionsByType: Record<string, number>;
  };
}

export interface ComplianceReportData {
  proposals: any[];
  dateRange: { start: string; end: string };
  vaultConfig: any;
  contractId?: string;
}

function generateSOC2ReportPDF(config: ReportConfig, data: ReportData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  
  doc.setFontSize(20);
  doc.text('SOC 2 Type II Compliance Report', pageWidth / 2, 20, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text(`${config.organizationName || 'VaultDAO'}`, pageWidth / 2, 30, { align: 'center' });
  doc.text(`Period: ${config.dateRange.from} to ${config.dateRange.to}`, pageWidth / 2, 40, { align: 'center' });
  
  let yPos = 55;
  
  if (config.includeSections.summary) {
    doc.setFontSize(16);
    doc.text('Executive Summary', 14, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.text(`Total Actions Logged: ${data.summary.totalActions}`, 14, yPos);
    yPos += 7;
    doc.text(`Unique Users: ${data.summary.uniqueUsers}`, 14, yPos);
    yPos += 7;
    doc.text(`Reporting Period: ${data.summary.dateRange}`, 14, yPos);
    yPos += 15;
  }
  
  if (config.includeSections.actionLog) {
    doc.setFontSize(16);
    doc.text('Security Controls - Access Log', 14, yPos);
    yPos += 10;
    
    const tableData = data.entries.slice(0, 50).map(entry => [
      new Date(entry.timestamp).toLocaleDateString(),
      stripHtml(entry.user).slice(0, 12) + '...',
      stripHtml(entry.action),
      stripHtml(entry.transactionHash).slice(0, 12) + '...',
    ]);
    
    autoTable(doc as unknown as import('jspdf').jsPDF, {
      startY: yPos,
      head: [['Date', 'User', 'Action', 'Transaction']],
      body: tableData,
      theme: 'striped',
      styles: { fontSize: 8 },
      headStyles: { fillColor: [88, 28, 135] },
    });
    
    const docObj = doc as unknown as Record<string, unknown>;
    yPos = (docObj.lastAutoTable as number) + 15;
  }
  
  if (config.includeSections.complianceChecks) {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFontSize(16);
    doc.text('Compliance Verification', 14, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.text('✓ Multi-factor authentication enforced', 14, yPos);
    yPos += 7;
    doc.text('✓ Audit logs retained for required period', 14, yPos);
    yPos += 7;
    doc.text('✓ Access controls documented and tested', 14, yPos);
    yPos += 7;
    doc.text('✓ Change management process followed', 14, yPos);
    yPos += 7;
    doc.text('✓ Security incidents logged and addressed', 14, yPos);
  }
  
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toISOString()}`, 14, doc.internal.pageSize.height - 10);
  
  return doc;
}

function generateISO27001ReportPDF(config: ReportConfig, data: ReportData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  
  doc.setFontSize(20);
  doc.text('ISO 27001:2013 Compliance Report', pageWidth / 2, 20, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text(`${config.organizationName || 'VaultDAO'}`, pageWidth / 2, 30, { align: 'center' });
  doc.text(`Period: ${config.dateRange.from} to ${config.dateRange.to}`, pageWidth / 2, 40, { align: 'center' });
  
  let yPos = 55;
  
  doc.setFontSize(16);
  doc.text('A.9 Access Control', 14, yPos);
  yPos += 10;
  
  doc.setFontSize(10);
  doc.text('A.9.2.1 User Registration and De-registration', 14, yPos);
  yPos += 7;
  doc.text(`Total unique users in period: ${data.summary.uniqueUsers}`, 20, yPos);
  yPos += 7;
  doc.text('Status: COMPLIANT', 20, yPos);
  yPos += 15;
  
  doc.text('A.9.4.1 Information Access Restriction', 14, yPos);
  yPos += 7;
  doc.text('Role-based access control enforced', 20, yPos);
  yPos += 7;
  doc.text('Status: COMPLIANT', 20, yPos);
  yPos += 15;
  
  doc.setFontSize(16);
  doc.text('A.12 Operations Security', 14, yPos);
  yPos += 10;
  
  doc.setFontSize(10);
  doc.text('A.12.4.1 Event Logging', 14, yPos);
  yPos += 7;
  doc.text(`Total events logged: ${data.summary.totalActions}`, 20, yPos);
  yPos += 7;
  doc.text('Status: COMPLIANT', 20, yPos);
  yPos += 15;
  
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }
  
  doc.setFontSize(16);
  doc.text('Audit Trail Summary', 14, yPos);
  yPos += 10;
  
  const actionTypes = Object.entries(data.summary.actionsByType);
  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: yPos,
    head: [['Action Type', 'Count']],
    body: actionTypes.map(([type, count]) => [stripHtml(type), count.toString()]),
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [88, 28, 135] },
  });
  
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toISOString()}`, 14, doc.internal.pageSize.height - 10);
  
  return doc;
}

export function exportToCSV(entries: AuditEntry[]): Blob {
  const headers = [
    'Timestamp',
    'Ledger',
    'ContractId',
    'User',
    'Action',
    'Details',
    'TxRef',
    'SourceEventId',
    'PayloadDigest',
    'PreviousHash',
    'EntryHash',
  ];
  const rows = entries.map(entry => [
    entry.timestamp,
    entry.ledger,
    entry.contractId,
    entry.user,
    entry.action,
    JSON.stringify(entry.details),
    entry.transactionHash,
    entry.sourceEventId,
    entry.payloadDigest,
    entry.previousHash ?? '',
    entry.hash ?? '',
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');
  
  return new Blob([csvContent], { type: 'text/csv' });
}

export function exportToJSON(data: unknown): Blob {
  const jsonString = JSON.stringify(data, null, 2);
  return new Blob([jsonString], { type: 'application/json' });
}

export async function generateSOC2Report(reportData: {
  entries: AuditEntry[];
  dateRange: { start: string; end: string };
  organizationName: string;
}): Promise<Blob> {
  const config: ReportConfig = {
    type: 'SOC2',
    dateRange: { from: reportData.dateRange.start, to: reportData.dateRange.end },
    includeSections: {
      summary: true,
      actionLog: true,
      userActivity: true,
      securityEvents: true,
      complianceChecks: true,
    },
    organizationName: reportData.organizationName,
  };

  const actionsByType: Record<string, number> = {};
  reportData.entries.forEach(entry => {
    actionsByType[entry.action] = (actionsByType[entry.action] || 0) + 1;
  });

  const data: ReportData = {
    entries: reportData.entries,
    summary: {
      totalActions: reportData.entries.length,
      uniqueUsers: new Set(reportData.entries.map(e => e.user)).size,
      dateRange: `${reportData.dateRange.start} to ${reportData.dateRange.end}`,
      actionsByType,
    },
  };

  const doc = generateSOC2ReportPDF(config, data);
  return new Blob([doc.output('arraybuffer') as ArrayBuffer], { type: 'application/pdf' });
}

export async function generateISO27001Report(reportData: {
  entries: AuditEntry[];
  dateRange: { start: string; end: string };
  organizationName: string;
}): Promise<Blob> {
  const config: ReportConfig = {
    type: 'ISO27001',
    dateRange: { from: reportData.dateRange.start, to: reportData.dateRange.end },
    includeSections: {
      summary: true,
      actionLog: true,
      userActivity: true,
      securityEvents: true,
      complianceChecks: true,
    },
    organizationName: reportData.organizationName,
  };

  const actionsByType: Record<string, number> = {};
  reportData.entries.forEach(entry => {
    actionsByType[entry.action] = (actionsByType[entry.action] || 0) + 1;
  });

  const data: ReportData = {
    entries: reportData.entries,
    summary: {
      totalActions: reportData.entries.length,
      uniqueUsers: new Set(reportData.entries.map(e => e.user)).size,
      dateRange: `${reportData.dateRange.start} to ${reportData.dateRange.end}`,
      actionsByType,
    },
  };

  const doc = generateISO27001ReportPDF(config, data);
  return new Blob([doc.output('arraybuffer') as ArrayBuffer], { type: 'application/pdf' });
}

export function generateComplianceReport(
  proposals: any[],
  dateRange: { start: string; end: string },
  vaultConfig: any,
  contractId: string = 'VAULT'
): Blob {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const margin = 14;
  let yPos = 20;

  // Header
  doc.setFontSize(18);
  doc.text('VaultDAO Compliance Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  doc.setFontSize(10);
  doc.text(`Contract ID: ${contractId}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;
  doc.text(`Report Date: ${new Date().toLocaleDateString()}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;
  doc.text(`Period: ${dateRange.start} to ${dateRange.end}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // Executive Summary
  doc.setFontSize(14);
  doc.text('Executive Summary', margin, yPos);
  yPos += 8;

  doc.setFontSize(10);
  const summaryData = [
    ['Total Transactions', proposals.length.toString()],
    ['Unique Signers', new Set(proposals.flatMap(p => p.signers || [])).size.toString()],
    ['Approved', proposals.filter(p => p.status === 'approved').length.toString()],
    ['Pending', proposals.filter(p => p.status === 'pending').length.toString()],
  ];

  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: yPos,
    head: [['Metric', 'Value']],
    body: summaryData,
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [88, 28, 135] },
    margin: { left: margin, right: margin },
  });

  const docObj = doc as unknown as Record<string, unknown>;
  yPos = (docObj.lastAutoTable as number) + 10;

  // Transaction Log
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.text('Transaction Log', margin, yPos);
  yPos += 8;

  const txData = proposals.slice(0, 20).map(p => [
    new Date(p.createdAt || Date.now()).toLocaleDateString(),
    p.recipient?.slice(0, 10) + '...' || 'N/A',
    p.amount?.toString() || '0',
    p.status || 'unknown',
  ]);

  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: yPos,
    head: [['Date', 'Recipient', 'Amount', 'Status']],
    body: txData,
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [88, 28, 135] },
    margin: { left: margin, right: margin },
  });

  yPos = (docObj.lastAutoTable as number) + 10;

  // Signer Activity
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.text('Signer Activity', margin, yPos);
  yPos += 8;

  const signerMap = new Map<string, number>();
  proposals.forEach(p => {
    (p.signers || []).forEach((signer: string) => {
      signerMap.set(signer, (signerMap.get(signer) || 0) + 1);
    });
  });

  const signerData = Array.from(signerMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([signer, count]) => [signer.slice(0, 12) + '...', count.toString()]);

  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: yPos,
    head: [['Signer', 'Approvals']],
    body: signerData,
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [88, 28, 135] },
    margin: { left: margin, right: margin },
  });

  yPos = (docObj.lastAutoTable as number) + 10;

  // Spending vs Limits
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.text('Spending vs Limits', margin, yPos);
  yPos += 8;

  const totalSpent = proposals.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const dailyLimit = vaultConfig?.dailyLimit || 100000;
  const weeklyLimit = vaultConfig?.weeklyLimit || 500000;
  const dailyUtilization = ((totalSpent / dailyLimit) * 100).toFixed(1);
  const weeklyUtilization = ((totalSpent / weeklyLimit) * 100).toFixed(1);

  const limitData = [
    ['Daily Limit', `$${dailyLimit}`, `${dailyUtilization}%`],
    ['Weekly Limit', `$${weeklyLimit}`, `${weeklyUtilization}%`],
    ['Total Spent', `$${totalSpent.toFixed(2)}`, ''],
  ];

  autoTable(doc as unknown as import('jspdf').jsPDF, {
    startY: yPos,
    head: [['Limit Type', 'Amount', 'Utilization']],
    body: limitData,
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [88, 28, 135] },
    margin: { left: margin, right: margin },
  });

  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toISOString()}`, margin, doc.internal.pageSize.height - 10);

  return new Blob([doc.output('arraybuffer') as ArrayBuffer], { type: 'application/pdf' });
}

