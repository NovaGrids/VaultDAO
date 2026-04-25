import React, { useState } from 'react';
import { Download, FileText, Database } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { saveExportHistoryItem } from '../utils/exportHistory';
import { exportAuditToPDF } from '../utils/pdfExport';
import { env } from '../config/env';
import type { BackendAuditEntry } from './AuditLog';

interface AuditExporterProps {
  entries: BackendAuditEntry[];
}

type ExportFormat = 'CSV' | 'PDF';

function buildCSV(entries: BackendAuditEntry[]): Blob {
  const headers = ['Timestamp', 'Action', 'Actor', 'Target', 'TxHash', 'Details'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.action,
    e.actor,
    e.target ?? '',
    e.txHash ?? '',
    JSON.stringify(e.details ?? {}),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

const AuditExporter: React.FC<AuditExporterProps> = ({ entries }) => {
  const { notify } = useToast();
  const [format, setFormat] = useState<ExportFormat>('CSV');
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (entries.length === 0) {
      notify('no_data', 'No entries to export.', 'info');
      return;
    }
    setBusy(true);
    try {
      let blob: Blob;
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `audit_export_${timestamp}.${format.toLowerCase()}`;

      if (format === 'CSV') {
        blob = buildCSV(entries);
      } else {
        blob = await exportAuditToPDF(entries, env.contractId);
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      saveExportHistoryItem({
        filename,
        dataType: 'audit',
        format,
        exportedAt: new Date().toISOString(),
        vaultAddress: env.contractId,
      });

      notify('export_success', `Exported ${entries.length} entries as ${format}.`, 'success');
    } catch (e) {
      notify('export_error', e instanceof Error ? e.message : 'Export failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Format toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        {(['CSV', 'PDF'] as ExportFormat[]).map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
              format === f ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {f === 'CSV' ? <Database size={14} /> : <FileText size={14} />}
            {f}
          </button>
        ))}
      </div>

      <button
        onClick={() => void handleExport()}
        disabled={busy || entries.length === 0}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm transition-colors"
      >
        <Download size={14} />
        {busy ? 'Exporting…' : `Export ${entries.length}`}
      </button>
    </div>
  );
};

export default AuditExporter;
