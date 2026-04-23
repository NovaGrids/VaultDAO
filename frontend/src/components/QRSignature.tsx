import React from 'react';
import { Smartphone } from 'lucide-react';

interface QRSignatureProps {
  transactionXDR: string;
  onRefresh?: () => void;
  signed?: boolean;
}

const QRSignature: React.FC<QRSignatureProps> = ({ transactionXDR, signed }) => {
  return (
    <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-3 sm:p-4 md:p-6">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Smartphone size={16} className="sm:w-[18px] sm:h-[18px] text-purple-400" />
        <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">Mobile Signing</h4>
      </div>
      <div className="flex flex-col items-center justify-center py-4 sm:py-6 md:py-8 text-center">
        {/* QR Code Container - Responsive sizing */}
        <div className="w-full max-w-[200px] sm:max-w-[240px] md:max-w-[280px] aspect-square bg-gray-700 rounded-lg flex items-center justify-center mb-3 sm:mb-4 touch-manipulation">
          <p className="text-gray-400 text-xs sm:text-sm px-4">QR Code Placeholder</p>
        </div>
        
        {/* Status Text */}
        <p className="text-xs sm:text-sm text-gray-500 max-w-[280px] sm:max-w-xs px-4">
          {signed ? 'Transaction signed successfully' : 'Scan with mobile wallet to sign'}
        </p>
        
        {/* Transaction XDR Preview */}
        <p className="text-[10px] sm:text-xs text-gray-600 mt-2 font-mono break-all max-w-[280px] sm:max-w-xs px-4">
          {transactionXDR.slice(0, 20)}...
        </p>
      </div>
    </div>
  );
};

export default QRSignature;
