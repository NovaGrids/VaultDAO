import React from 'react';
import { Smartphone } from 'lucide-react';

interface QRSignatureProps {
  transactionXDR: string;
  onRefresh?: () => void;
  signed?: boolean;
}

const QRSignature: React.FC<QRSignatureProps> = ({ transactionXDR, signed }) => {
  return (
    <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={18} className="text-purple-400" />
        <h4 className="text-sm font-bold text-white uppercase tracking-wider">Mobile Signing</h4>
      </div>
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-48 h-48 bg-gray-700 rounded-lg flex items-center justify-center mb-4">
          <p className="text-gray-400 text-sm">QR Code Placeholder</p>
        </div>
        <p className="text-xs text-gray-500 max-w-xs">
          {signed ? 'Transaction signed successfully' : 'Scan with mobile wallet to sign'}
        </p>
        <p className="text-xs text-gray-600 mt-2 font-mono break-all max-w-xs">
          {transactionXDR.slice(0, 20)}...
        </p>
      </div>
    </div>
  );
};

export default QRSignature;
