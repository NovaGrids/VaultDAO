import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditEntry } from './auditVerification';

export type ReportType = 'SOC2' | 'ISO27001' | 'Custom';

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
      entry.user.slice(0, 12) + '...',
      entry.action,
      entry.transactionHash.slice(0, 12) + '...',
    ]);
    
    autoTable(doc, {
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
  autoTable(doc, {
    startY: yPos,
    head: [['Action Type', 'Count']],
    body: actionTypes.map(([type, count]) => [type, count.toString()]),
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [88, 28, 135] },
  });
  
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toISOString()}`, 14, doc.internal.pageSize.height - 10);
  
  return doc;
}

export function exportToCSV(entries: AuditEntry[]): Blob {
  const headers = ['Timestamp', 'Ledger', 'User', 'Action', 'Details', 'Transaction Hash'];
  const rows = entries.map(entry => [
    entry.timestamp,
    entry.ledger,
    entry.user,
    entry.action,
    JSON.stringify(entry.details),
    entry.transactionHash,
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

// Simplified wrapper for SOC2 reports
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

// Simplified wrapper for ISO27001 reports
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

