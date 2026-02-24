import React from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import type { Anomaly } from '../utils/anomalyDetection';

interface AnomalyDetectorProps {
  anomalies: Anomaly[];
}

const AnomalyDetector: React.FC<AnomalyDetectorProps> = ({ anomalies }) => {
  if (anomalies.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 text-center">
        <Info size={32} className="mx-auto text-green-400 mb-2" />
        <p className="text-gray-400">No anomalies detected</p>
        <p className="text-sm text-gray-500 mt-1">All transactions appear normal</p>
      </div>
    );
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'border-red-500 bg-red-500/10';
      case 'medium': return 'border-amber-500 bg-amber-500/10';
      default: return 'border-blue-500 bg-blue-500/10';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high': return <AlertTriangle size={20} className="text-red-400" />;
      case 'medium': return <AlertCircle size={20} className="text-amber-400" />;
      default: return <Info size={20} className="text-blue-400" />;
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-white flex items-center gap-2">
        <AlertTriangle size={18} className="text-amber-400" />
        Anomaly Detection ({anomalies.length})
      </h4>
      {anomalies.map((anomaly) => (
        <div
          key={anomaly.id}
          className={`rounded-lg border p-4 ${getSeverityColor(anomaly.severity)}`}
        >
          <div className="flex items-start gap-3">
            {getSeverityIcon(anomaly.severity)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium uppercase text-gray-400">
                  {anomaly.type}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                  {anomaly.severity}
                </span>
              </div>
              <p className="text-sm text-white">{anomaly.message}</p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(anomaly.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AnomalyDetector;
