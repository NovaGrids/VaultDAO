import React, { useState, useMemo, useCallback, useEffect } from 'react';

// REMOVED: unused import of exportAnalyticsToCsv to fix "value never read" and "module not found" errors.

import {
  timestampedFilename,
  filterByDateRange,
  previewRows,
  toCsv,
  toJson,
  downloadCsv,
  downloadJson,
  generatePdf,
  deriveFinancialSummary,
  type TabularRow,
} from '../../utils/vaultDataExport';

export type DataType = 'proposals' | 'activity' | 'transactions' | 'financial summary';
export type ExportFormat = 'csv' | 'json' | 'pdf';

export interface ExportDatasets {
  proposals: TabularRow[];
  activity: TabularRow[];
  transactions: TabularRow[];
}

export interface ExportMetadata {
  vaultName: string;
  vaultAddress: string;
  dataType: DataType;
  format: ExportFormat;
  filename: string;
  rowCount: number;
  storedContent?: string;
  mimeType?: string;
}

const DATA_TYPES: { value: DataType; label: string }[] = [
  { value: 'proposals', label: 'Proposals' },
  { value: 'activity', label: 'Activity' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'financial summary', label: 'Financial Summary' },
];

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'pdf', label: 'PDF' },
];

function getDateKeyForDataType(dataType: DataType): string {
  switch (dataType) {
    case 'proposals':
      return 'createdAt';
    case 'activity':
    case 'transactions':
    case 'financial summary':
      return 'timestamp';
    default:
      return 'timestamp';
  }
}

function getDefaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  vaultName: string;
  vaultAddress: string;
  initialDataType?: DataType;
  datasets: ExportDatasets;
  onExported?: (meta: ExportMetadata) => void;
}

function getHeadersAndRows(
  rows: TabularRow[],
  _dataType: DataType,
  isFinancialSummary: boolean
): { headers: string[]; rows: TabularRow[] } {
  if (rows.length === 0) return { headers: [], rows: [] };
  if (isFinancialSummary) {
    const summary = deriveFinancialSummary(rows);
    return {
      headers: ['label', 'value'],
      rows: summary.map((s: { label: string; value: string }) => ({
        label: s.label,
        value: s.value,
      })),
    };
  }
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  return { headers, rows };
}

const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  vaultName,
  vaultAddress,
  initialDataType = 'proposals',
  datasets,
  onExported,
}) => {
  const [dataType, setDataType] = useState<DataType>(initialDataType);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [isLoading, setIsLoading] = useState(false);

  const toBase64 = (text: string): string => {
    const utf8 = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of utf8) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  };

  useEffect(() => {
    if (isOpen) setDataType(initialDataType);
  }, [isOpen, initialDataType]);

  const isFinancialSummary = dataType === 'financial summary';
  const sourceRows = useMemo(() => {
    switch (dataType) {
      case 'proposals':
        return datasets.proposals;
      case 'activity':
        return datasets.activity;
      case 'transactions':
      case 'financial summary':
        return datasets.transactions;
      default:
        return [];
    }
  }, [dataType, datasets]);

  const dateKey = getDateKeyForDataType(dataType);
  const filteredRows = useMemo(() => {
    return filterByDateRange(
      sourceRows,
      dateKey,
      dateRange.start || undefined,
      dateRange.end || undefined
    );
  }, [sourceRows, dateKey, dateRange]);

  const { headers, rows } = useMemo(
    () => getHeadersAndRows(filteredRows, dataType, isFinancialSummary),
    [filteredRows, dataType, isFinancialSummary]
  );

  const previewData: TabularRow[] = useMemo(() => previewRows(rows, 10), [rows]);

  const handleExport = useCallback(() => {
    if (headers.length === 0 && rows.length === 0) return;
    setIsLoading(true);
    try {
      const prefix = `${vaultName.replace(/\s+/g, '_')}_${dataType.replace(/\s+/g, '_')}`;
      const filename = timestampedFilename(prefix, format);
      let storedContent: string | undefined;
      let mimeType: string | undefined;

      if (format === 'csv') {
        const csv = toCsv(headers, rows);
        downloadCsv(headers, rows, filename);
        storedContent = toBase64(csv);
        mimeType = 'text/csv;charset=utf-8';
      } else if (format === 'json') {
        const json = toJson(headers, rows);
        downloadJson(headers, rows, filename);
        storedContent = toBase64(json);
        mimeType = 'application/json;charset=utf-8';
      } else {
        const summary: { label: string; value: string }[] | undefined =
          isFinancialSummary
            ? rows.map((r) => ({
                label: String(r.label ?? ''),
                value: String(r.value ?? ''),
              }))
            : dataType === 'transactions'
              ? deriveFinancialSummary(rows)
              : undefined;
        generatePdf({
          title: vaultName,
          subtitle: `Vault: ${vaultAddress} | Period: ${dateRange.start} – ${dateRange.end}`,
          headers,
          rows,
          summary: summary?.length ? summary : undefined,
          filename,
        });
      }

      onExported?.({
        vaultName,
        vaultAddress,
        dataType,
        format,
        filename,
        rowCount: rows.length,
        storedContent,
        mimeType,
      });
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [
    headers,
    rows,
    vaultName,
    vaultAddress,
    dataType,
    format,
    dateRange,
    isFinancialSummary,
    onExported,
    onClose,
  ]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/60"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="flex flex-col w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[90vh] sm:rounded-xl bg-gray-800 border border-gray-700 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-gray-700">
          <h2
            id="export-modal-title"
            className="text-xl font-bold text-white"
          >
            Export Data
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {vaultName} • {vaultAddress.slice(0, 8)}…{vaultAddress.slice(-4)}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div>
            <label htmlFor="data-type" className="block text-sm font-medium text-gray-300 mb-2">
              Data type
            </label>
            <select
              id="data-type"
              value={dataType}
              onChange={(e) => setDataType(e.target.value as DataType)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={isLoading}
            >
              {DATA_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="format" className="block text-sm font-medium text-gray-300 mb-2">
              Format
            </label>
            <select
              id="format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={isLoading}
            >
              {EXPORT_FORMATS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date-start" className="block text-sm font-medium text-gray-300 mb-2">
                Start date
              </label>
              <input
                id="date-start"
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((r) => ({ ...r, start: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="date-end" className="block text-sm font-medium text-gray-300 mb-2">
                End date
              </label>
              <input
                id="date-end"
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((r) => ({ ...r, end: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Preview (first 10 rows)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-600 max-h-48">
              {previewData.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">No data in selected range.</p>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-700 text-gray-300 sticky top-0">
                    <tr>
                      {headers.map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 font-medium whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-gray-300 divide-y divide-gray-600">
                    {previewData.map((row: TabularRow, i: number) => (
                      <tr key={i} className="bg-gray-800/50 hover:bg-gray-700/50">
                        {headers.map((h) => (
                          <td
                            key={h}
                            className="px-3 py-2 whitespace-nowrap max-w-[12rem] truncate"
                            title={String(row[h] ?? '')}
                          >
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {rows.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Showing {Math.min(10, rows.length)} of {rows.length} rows
              </p>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-700 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium min-h-[44px] sm:min-h-0"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isLoading || rows.length === 0}
            className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium min-h-[44px] sm:min-h-0"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                  aria-hidden
                />
                Exporting…
              </span>
            ) : (
              'Export'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;