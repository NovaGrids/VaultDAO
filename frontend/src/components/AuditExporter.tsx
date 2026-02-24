import React, { useState, useEffect } from 'react';
import { Download, FileText, Database, Code, CheckCircle } from 'lucide-react';
import { exportToCSV, exportToJSON } from '../utils/reportGenerator';
import { generateSOC2Report } from '../utils/reportGenerator';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import type { AuditEntry } from '../utils/auditVerification';
import { buildAuditChain, signAuditData } from '../utils/auditVerification';

type ExportFormat = 'PDF' | 'CSV' | 'JSON';

interface ExportConfig {
  format: ExportFormat;
  includeMetadata: boolean;
  includeSignature: boolean;
  dateFrom: string;
  dateTo: string;
  selectedActions: string[];
}

const AuditExporter: React.FC = () => {
  const { getVaultEvents } = useVaultContract();
  const { notify } = useToast();
  
  const [auditData, setAuditData] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  const [config, setConfig] = useState<ExportConfig>({
    format: 'CSV',
    includeMetadata: true,
    includeSignature: false,
    dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    dateTo: new Date().toISOString().split('T')[0],
    selectedActions: [],
  });

  useEffect(() => {
    fetchAuditData();
  }, []);

  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const result = await getVaultEvents();
      const auditEntries: AuditEntry[] = result.activities.map((activity, index) => ({
        id: activity.id,
        timestamp: activity.timestamp,
        ledger: activity.ledger,
        user: activity.actor || 'System',
        action: activity.type,
        details: activity.details,
        transactionHash: activity.eventId || `tx_${index}`,
      }));
      
      const chainedEntries = buildAuditChain(auditEntries);
      setAuditData(chainedEntries);
    } catch (err) {
      console.error('Failed to fetch audit data:', err);
      notify('audit_fetch_error', 'Failed to load audit data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filterData = (): AuditEntry[] => {
    const start = new Date(config.dateFrom);
    const end = new Date(config.dateTo);
    end.setHours(23, 59, 59);
    
    return auditData.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      const inDateRange = entryDate >= start && entryDate <= end;
      const matchesAction = config.selectedActions.length === 0 || 
                           config.selectedActions.includes(entry.action);
      return inDateRange && matchesAction;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const filteredData = filterData();
      
      if (filteredData.length === 0) {
        notify('no_data', 'No data to export with current filters', 'info');
        setExporting(false);
        return;
      }

      let blob: Blob;
      let filename: string;
      const timestamp = new Date().toISOString().split('T')[0];

      // Add metadata if requested
      const exportData = config.includeMetadata ? {
        metadata: {
          exportDate: new Date().toISOString(),
          organization: 'VaultDAO',
          dateRange: {
            start: config.dateFrom,
            end: config.dateTo,
          },
          totalEntries: filteredData.length,
          filters: {
            actions: config.selectedActions,
          },
        },
        data: filteredData,
      } : filteredData;

      // Add cryptographic signature if requested
      let signatureData = null;
      if (config.includeSignature) {
        signatureData = await signAuditData(filteredData);
      }

      switch (config.format) {
        case 'CSV': {
          blob = exportToCSV(filteredData);
          filename = `audit_export_${timestamp}.csv`;
          break;
        }
        
        case 'JSON': {
          const jsonData = config.includeSignature 
            ? { ...exportData, signature: signatureData }
            : exportData;
          blob = exportToJSON(jsonData);
          filename = `audit_export_${timestamp}.json`;
          break;
        }
        
        case 'PDF': {
          blob = await generateSOC2Report({
            entries: filteredData,
            dateRange: {
              start: config.dateFrom,
              end: config.dateTo,
            },
            organizationName: 'VaultDAO',
          });
          filename = `audit_export_${timestamp}.pdf`;
          break;
        }
        
        default:
          throw new Error('Invalid export format');
      }

      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notify('export_success', `Exported ${filteredData.length} entries as ${config.format}`, 'success');
    } catch (err) {
      console.error('Failed to export:', err);
      notify('export_error', 'Failed to export audit data', 'error');
    } finally {
      setExporting(false);
    }
  };

  const actionTypes = Array.from(new Set(auditData.map(e => e.action)));

  const toggleAction = (action: string) => {
    setConfig(prev => ({
      ...prev,
      selectedActions: prev.selectedActions.includes(action)
        ? prev.selectedActions.filter(a => a !== action)
        : [...prev.selectedActions, action]
    }));
  };

  const selectAllActions = () => {
    setConfig(prev => ({
      ...prev,
      selectedActions: actionTypes,
    }));
  };

  const clearActions = () => {
    setConfig(prev => ({
      ...prev,
      selectedActions: [],
    }));
  };

  const filteredCount = filterData().length;

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 text-white">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Download className="text-purple-500" />
            Audit Data Exporter
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Export audit logs in multiple formats with optional cryptographic signatures
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 mb-6">
          {/* Format Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Export Format
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setConfig(prev => ({ ...prev, format: 'CSV' }))}
                className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                  config.format === 'CSV'
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                }`}
              >
                <Database size={24} className={config.format === 'CSV' ? 'text-purple-400' : 'text-gray-400'} />
                <span className="mt-2 font-medium">CSV</span>
                <span className="text-xs text-gray-400 mt-1">Spreadsheet</span>
              </button>

              <button
                onClick={() => setConfig(prev => ({ ...prev, format: 'JSON' }))}
                className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                  config.format === 'JSON'
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                }`}
              >
                <Code size={24} className={config.format === 'JSON' ? 'text-purple-400' : 'text-gray-400'} />
                <span className="mt-2 font-medium">JSON</span>
                <span className="text-xs text-gray-400 mt-1">Structured</span>
              </button>

              <button
                onClick={() => setConfig(prev => ({ ...prev, format: 'PDF' }))}
                className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                  config.format === 'PDF'
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                }`}
              >
                <FileText size={24} className={config.format === 'PDF' ? 'text-purple-400' : 'text-gray-400'} />
                <span className="mt-2 font-medium">PDF</span>
                <span className="text-xs text-gray-400 mt-1">Document</span>
              </button>
            </div>
          </div>

          {/* Date Range */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Date Range
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={config.dateFrom}
                  onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={config.dateTo}
                  onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          </div>

          {/* Action Type Filters */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-300">
                Action Types
              </label>
              <div className="flex gap-2">
                <button
                  onClick={selectAllActions}
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  Select All
                </button>
                <span className="text-gray-600">|</span>
                <button
                  onClick={clearActions}
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {actionTypes.map(action => (
                <button
                  key={action}
                  onClick={() => toggleAction(action)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    config.selectedActions.includes(action)
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {action}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {config.selectedActions.length === 0 
                ? 'All action types will be exported' 
                : `${config.selectedActions.length} action types selected`}
            </p>
          </div>

          {/* Options */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Export Options
            </label>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg cursor-pointer hover:bg-gray-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={config.includeMetadata}
                  onChange={(e) => setConfig(prev => ({ ...prev, includeMetadata: e.target.checked }))}
                  className="mt-1 w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-900"
                />
                <div>
                  <div className="text-sm font-medium">Include Metadata</div>
                  <div className="text-xs text-gray-400">Add export timestamp, organization details, and filter information</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg cursor-pointer hover:bg-gray-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={config.includeSignature}
                  onChange={(e) => setConfig(prev => ({ ...prev, includeSignature: e.target.checked }))}
                  className="mt-1 w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-900"
                />
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    Cryptographic Signature
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded">JSON only</span>
                  </div>
                  <div className="text-xs text-gray-400">Add hash-based signature for data integrity verification</div>
                </div>
              </label>
            </div>
          </div>

          {/* Export Summary */}
          <div className="bg-gray-900/50 rounded-lg p-4 mb-6 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Entries to export:</span>
              <span className="text-lg font-bold text-purple-400">{filteredCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Format:</span>
              <span className="text-sm font-medium">{config.format}</span>
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExport}
            disabled={loading || exporting || filteredCount === 0}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 px-6 py-4 rounded-lg font-medium text-lg transition-colors"
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Exporting...
              </>
            ) : (
              <>
                <Download size={20} />
                Export {filteredCount} Entries
              </>
            )}
          </button>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Total Available</div>
            <div className="text-2xl font-bold text-white">{auditData.length}</div>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">After Filters</div>
            <div className="text-2xl font-bold text-purple-400">{filteredCount}</div>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Export Format</div>
            <div className="text-2xl font-bold text-white">{config.format}</div>
          </div>
        </div>

        {/* Format Info */}
        <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="text-blue-400 mt-0.5" size={18} />
            <div className="text-sm text-blue-300">
              <p className="font-medium mb-1">Export Format Details:</p>
              {config.format === 'CSV' && (
                <p>CSV files can be opened in Excel, Google Sheets, or any spreadsheet application.</p>
              )}
              {config.format === 'JSON' && (
                <p>JSON files include full audit trail data with optional cryptographic signatures for verification.</p>
              )}
              {config.format === 'PDF' && (
                <p>PDF reports are formatted for compliance documentation and archival purposes.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditExporter;
