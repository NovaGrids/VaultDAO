import React, { useState, useEffect } from 'react';
import { FileText, Download, Calendar, Eye, CheckSquare } from 'lucide-react';
import { generateSOC2Report, generateISO27001Report } from '../utils/reportGenerator';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import type { AuditEntry } from '../utils/auditVerification';
import { buildAuditChain } from '../utils/auditVerification';

type ReportType = 'SOC2' | 'ISO27001' | 'Custom';

interface ReportConfig {
  type: ReportType;
  startDate: string;
  endDate: string;
  sections: string[];
}

const SOC2_SECTIONS = [
  'Security',
  'Availability',
  'Processing Integrity',
  'Confidentiality',
  'Privacy'
];

const ISO27001_CONTROLS = [
  'A.9 Access Control',
  'A.10 Cryptography',
  'A.12 Operations Security',
  'A.14 System Acquisition',
  'A.16 Incident Management',
  'A.17 Business Continuity',
  'A.18 Compliance'
];

const ComplianceReports: React.FC = () => {
  const { getVaultEvents } = useVaultContract();
  const { notify } = useToast();
  
  const [auditData, setAuditData] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  
  const [config, setConfig] = useState<ReportConfig>({
    type: 'SOC2',
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    sections: SOC2_SECTIONS,
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

  const handleTypeChange = (type: ReportType) => {
    setConfig(prev => ({
      ...prev,
      type,
      sections: type === 'SOC2' ? SOC2_SECTIONS : type === 'ISO27001' ? ISO27001_CONTROLS : [],
    }));
    setPreviewHtml(null);
  };

  const toggleSection = (section: string) => {
    setConfig(prev => ({
      ...prev,
      sections: prev.sections.includes(section)
        ? prev.sections.filter(s => s !== section)
        : [...prev.sections, section]
    }));
  };

  const filterDataByDateRange = (): AuditEntry[] => {
    const start = new Date(config.startDate);
    const end = new Date(config.endDate);
    end.setHours(23, 59, 59);
    
    return auditData.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      return entryDate >= start && entryDate <= end;
    });
  };

  const handlePreview = async () => {
    setGenerating(true);
    try {
      const filteredData = filterDataByDateRange();
      
      if (filteredData.length === 0) {
        notify('no_data', 'No audit data found in selected date range', 'info');
        setGenerating(false);
        return;
      }

      // Generate preview HTML (simplified version)
      const html = `
        <div style="padding: 20px; background: #1a1a1a; color: white; font-family: Arial, sans-serif;">
          <h1 style="color: #a855f7;">${config.type} Compliance Report</h1>
          <p><strong>Period:</strong> ${new Date(config.startDate).toLocaleDateString()} - ${new Date(config.endDate).toLocaleDateString()}</p>
          <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          
          <h2 style="margin-top: 30px;">Report Summary</h2>
          <ul>
            <li>Total Audit Entries: ${filteredData.length}</li>
            <li>Unique Users: ${new Set(filteredData.map(e => e.user)).size}</li>
            <li>Action Types: ${new Set(filteredData.map(e => e.action)).size}</li>
          </ul>

          <h2 style="margin-top: 30px;">Selected Sections</h2>
          <ul>
            ${config.sections.map(section => `<li>${section}</li>`).join('')}
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
              ${filteredData.slice(0, 10).map(entry => `
                <tr style="border-bottom: 1px solid #333;">
                  <td style="padding: 10px;">${new Date(entry.timestamp).toLocaleString()}</td>
                  <td style="padding: 10px; font-family: monospace;">${entry.user.slice(0, 8)}...${entry.user.slice(-6)}</td>
                  <td style="padding: 10px;">${entry.action}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <p style="margin-top: 30px; color: #999; font-size: 12px;">
            This is a preview. Download the full PDF report for complete details and compliance documentation.
          </p>
        </div>
      `;
      
      setPreviewHtml(html);
      notify('preview_ready', 'Report preview generated', 'success');
    } catch (err) {
      console.error('Failed to generate preview:', err);
      notify('preview_error', 'Failed to generate preview', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const filteredData = filterDataByDateRange();
      
      if (filteredData.length === 0) {
        notify('no_data', 'No audit data found in selected date range', 'info');
        setGenerating(false);
        return;
      }

      const reportData = {
        entries: filteredData,
        dateRange: {
          start: config.startDate,
          end: config.endDate,
        },
        organizationName: 'VaultDAO',
      };

      let blob: Blob;
      let filename: string;

      if (config.type === 'SOC2') {
        blob = await generateSOC2Report(reportData);
        filename = `SOC2_Report_${config.startDate}_to_${config.endDate}.pdf`;
      } else if (config.type === 'ISO27001') {
        blob = await generateISO27001Report(reportData);
        filename = `ISO27001_Report_${config.startDate}_to_${config.endDate}.pdf`;
      } else {
        // Custom report - use SOC2 as template
        blob = await generateSOC2Report(reportData);
        filename = `Custom_Report_${config.startDate}_to_${config.endDate}.pdf`;
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

      notify('report_downloaded', `${config.type} report downloaded successfully`, 'success');
    } catch (err) {
      console.error('Failed to generate report:', err);
      notify('report_error', 'Failed to generate report', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const availableSections = config.type === 'SOC2' ? SOC2_SECTIONS : ISO27001_CONTROLS;

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 text-white">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="text-purple-500" />
            Compliance Reports
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Generate SOC2, ISO 27001, and custom compliance documentation
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Configuration Panel */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
            <h2 className="text-xl font-semibold mb-4">Report Configuration</h2>

            {/* Report Type */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Report Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['SOC2', 'ISO27001', 'Custom'] as ReportType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => handleTypeChange(type)}
                    className={`px-4 py-3 rounded-lg font-medium transition-all ${
                      config.type === type
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <Calendar size={16} className="inline mr-1" />
                Date Range
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={config.startDate}
                    onChange={(e) => setConfig(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">End Date</label>
                  <input
                    type="date"
                    value={config.endDate}
                    onChange={(e) => setConfig(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>

            {/* Sections/Controls */}
            {config.type !== 'Custom' && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  <CheckSquare size={16} className="inline mr-1" />
                  {config.type === 'SOC2' ? 'Trust Service Criteria' : 'ISO Controls'}
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                  {availableSections.map(section => (
                    <button
                      key={section}
                      onClick={() => toggleSection(section)}
                      className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${
                        config.sections.includes(section)
                          ? 'bg-purple-600/20 border border-purple-500/50 text-purple-300'
                          : 'bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {section}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handlePreview}
                disabled={loading || generating || config.sections.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 px-4 py-3 rounded-lg font-medium transition-colors"
              >
                <Eye size={18} />
                Preview
              </button>
              <button
                onClick={handleDownload}
                disabled={loading || generating || config.sections.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 px-4 py-3 rounded-lg font-medium transition-colors"
              >
                <Download size={18} />
                {generating ? 'Generating...' : 'Download PDF'}
              </button>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
            <h2 className="text-xl font-semibold mb-4">Preview</h2>
            
            {previewHtml ? (
              <div 
                className="bg-white rounded-lg overflow-auto max-h-[600px]"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-[400px] text-gray-500">
                <Eye size={48} className="mb-4 opacity-30" />
                <p className="text-center">
                  Configure your report and click Preview to see a sample
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Statistics */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Available Data</div>
            <div className="text-2xl font-bold text-white">{auditData.length} entries</div>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Selected Period</div>
            <div className="text-2xl font-bold text-white">
              {filterDataByDateRange().length} entries
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Report Sections</div>
            <div className="text-2xl font-bold text-white">{config.sections.length}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComplianceReports;
