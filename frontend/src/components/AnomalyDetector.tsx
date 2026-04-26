import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { runFullAnomalyDetection, type Anomaly } from '../utils/anomalyDetection';

interface AnomalyDetectorProps {
  proposals: { id: string; amount: number; timestamp: number; recipient: string }[];
  historicalRecipients: Set<string>;
}

const DISMISSED_KEY = 'vaultdao_dismissed_anomalies';

const AnomalyDetector: React.FC<AnomalyDetectorProps> = ({ proposals, historicalRecipients }) => {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    const saved = sessionStorage.getItem(DISMISSED_KEY);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  const allAnomalies = useMemo(() => 
    runFullAnomalyDetection(proposals, historicalRecipients),
    [proposals, historicalRecipients]
  );

  const activeAnomalies = allAnomalies.filter(a => !dismissedIds.has(a.id));

  const handleDismiss = (id: string) => {
    const next = new Set(dismissedIds);
    next.add(id);
    setDismissedIds(next);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next)));
  };

  if (activeAnomalies.length === 0) return null;

  const getStyle = (severity: Anomaly['severity']) => {
    switch (severity) {
      case 'high': return { border: 'border-red-500/50', bg: 'bg-red-500/10', text: 'text-red-400', icon: AlertTriangle };
      case 'medium': return { border: 'border-amber-500/50', bg: 'bg-amber-500/10', text: 'text-amber-400', icon: AlertCircle };
      default: return { border: 'border-blue-500/50', bg: 'bg-blue-500/10', text: 'text-blue-400', icon: Info };
    }
  };

  return (
    <div className="space-y-3 mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-500" />
          Security Alerts ({activeAnomalies.length})
        </h3>
      </div>
      
      <div className="grid gap-2">
        {activeAnomalies.map((anomaly) => {
          const { border, bg, text, icon: Icon } = getStyle(anomaly.severity);
          return (
            <div
              key={anomaly.id}
              className={`group relative flex items-start gap-4 p-4 rounded-xl border ${border} ${bg} backdrop-blur-md transition-all hover:bg-opacity-20`}
            >
              <div className={`mt-0.5 rounded-full p-2 bg-black/20 ${text}`}>
                <Icon size={18} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold uppercase tracking-tighter px-1.5 py-0.5 rounded bg-black/30 ${text}`}>
                    {anomaly.type}
                  </span>
                  {anomaly.proposalId && (
                    <span className="text-[10px] text-gray-500 font-mono">
                      ID: {anomaly.proposalId.slice(0, 8)}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-white leading-tight">
                  {anomaly.message}
                </p>
              </div>

              <button
                onClick={() => handleDismiss(anomaly.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-black/20 rounded-lg text-gray-500 hover:text-white transition-all"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AnomalyDetector;
