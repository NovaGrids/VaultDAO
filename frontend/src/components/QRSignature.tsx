import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, RefreshCw, CheckCircle2 } from 'lucide-react';

interface QRSignatureProps {
  transactionXDR: string;
  onRefresh?: () => void;
  signed?: boolean;
}

const QRSignature: React.FC<QRSignatureProps> = ({ transactionXDR, onRefresh, signed }) => {
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    if (!autoRefresh || signed) return;
    const interval = setInterval(() => {
      onRefresh?.();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, signed, onRefresh]);

  return (
    <div className="bg-primary/30 rounded-xl border border-gray-800 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={18} className="text-accent" />
        <h4 className="text-sm font-bold text-white uppercase tracking-wider">Mobile Signing</h4>
      </div>

      {signed ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle2 size={48} className="text-green-500 mb-3" />
          <p className="text-sm font-bold text-green-500">Transaction Signed</p>
          <p className="text-xs text-gray-500 mt-1">Signature verified successfully</p>
        </div>
      ) : (
        <>
          {/* QR Code */}
          <div className="bg-white p-4 rounded-lg mb-4 flex justify-center">
            <QRCodeSVG 
              value={transactionXDR} 
              size={200}
              level="M"
              includeMargin
            />
          </div>

          {/* Instructions */}
          <div className="space-y-2 mb-4">
            <p className="text-xs text-gray-400">
              <span className="font-bold text-white">1.</span> Open your Stellar wallet app
            </p>
            <p className="text-xs text-gray-400">
              <span className="font-bold text-white">2.</span> Scan this QR code
            </p>
            <p className="text-xs text-gray-400">
              <span className="font-bold text-white">3.</span> Review and sign the transaction
            </p>
          </div>

          {/* Refresh Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-800">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-accent focus:ring-accent focus:ring-offset-0"
              />
              Auto-refresh (5s)
            </label>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
              >
                <RefreshCw size={14} /> Refresh
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default QRSignature;
