import React from 'react';
import { CheckCircle2, Clock, Download, Bell } from 'lucide-react';

export interface Signer {
  address: string;
  signed: boolean;
  timestamp?: string;
  verified?: boolean;
}

interface SignatureStatusProps {
  signers: Signer[];
  threshold: number;
  onRemind?: (address: string) => void;
  onExport?: () => void;
}

const SignatureStatus: React.FC<SignatureStatusProps> = ({ signers, threshold, onRemind, onExport }) => {
  const signedCount = signers.filter(s => s.signed).length;
  const progress = (signedCount / threshold) * 100;

  return (
    <div className="space-y-4">
      {/* Progress Bar */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Signature Progress</span>
          <span className="text-xs font-bold text-accent">{signedCount}/{threshold}</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-accent to-purple-500 transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>

      {/* Signers List */}
      <div className="bg-primary/20 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 bg-white/5 flex justify-between items-center">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Required Signers</h4>
          {onExport && (
            <button 
              onClick={onExport}
              className="text-xs text-accent hover:text-accent/80 flex items-center gap-1.5 transition-colors"
            >
              <Download size={14} /> Export
            </button>
          )}
        </div>
        <div className="divide-y divide-gray-800/50 max-h-64 overflow-y-auto custom-scrollbar">
          {signers.map((signer, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {signer.signed ? (
                  <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                ) : (
                  <Clock size={16} className="text-yellow-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <code className="text-xs text-gray-300 font-mono block truncate">
                    {signer.address}
                  </code>
                  {signer.signed && signer.timestamp && (
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">
                      {new Date(signer.timestamp).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              {!signer.signed && onRemind && (
                <button
                  onClick={() => onRemind(signer.address)}
                  className="ml-3 p-1.5 text-accent hover:bg-accent/10 rounded-lg transition-colors shrink-0"
                  title="Remind signer"
                >
                  <Bell size={14} />
                </button>
              )}
              {signer.signed && signer.verified && (
                <span className="ml-3 text-[10px] text-green-500 font-bold uppercase shrink-0">Verified</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SignatureStatus;
