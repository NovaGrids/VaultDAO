import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, RefreshCw, CheckCircle2 } from "lucide-react";

interface QRSignatureProps {
  proposalId: string | number;
  contractAddress: string;
  onRefresh?: () => void;
  signed?: boolean;
}

const QRSignature: React.FC<QRSignatureProps> = ({
  proposalId,
  contractAddress,
  onRefresh,
  signed = false,
}) => {
  const qrPayload = JSON.stringify({
    proposalId: String(proposalId),
    contract: contractAddress,
  });

  return (
    <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Smartphone size={18} className="text-purple-400" />
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">
            Mobile Signing
          </h4>
        </div>
        {onRefresh && !signed && (
          <button
            type="button"
            onClick={onRefresh}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Refresh QR code"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center gap-4">
        {signed ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <CheckCircle2 size={48} className="text-green-500" />
            <p className="text-sm text-green-400 font-semibold">
              Signed successfully
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white p-3 rounded-xl">
              <QRCodeSVG
                value={qrPayload}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
            <p className="text-xs text-gray-400 text-center max-w-xs">
              Scan with your mobile wallet to sign proposal #{proposalId}
            </p>
            <p className="text-[10px] text-gray-600 font-mono break-all text-center max-w-xs">
              {contractAddress.slice(0, 12)}…{contractAddress.slice(-8)}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default QRSignature;
