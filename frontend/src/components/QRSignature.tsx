import React, { useState, useEffect, useCallback, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, RefreshCw, CheckCircle2, Scan } from "lucide-react";

interface QRSignatureProps {
  proposalId: string | number;
  contractAddress: string;
  unsignedXdr?: string;
  onRefresh?: () => void;
  onSignedXdr?: (xdr: string) => void;
  signed?: boolean;
}

const CHUNK_SIZE = 500;

const QRSignature: React.FC<QRSignatureProps> = ({
  proposalId,
  contractAddress,
  unsignedXdr = "",
  onRefresh,
  onSignedXdr,
  signed = false,
}) => {
  const [scanning, setScanning] = useState(false);
  const [chunks, setChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  useEffect(() => {
    if (!unsignedXdr) return;
    const totalChunks = Math.ceil(unsignedXdr.length / CHUNK_SIZE);
    const newChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const payload = unsignedXdr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const checksum = btoa(payload).substring(0, 8); // simplified checksum
      newChunks.push(`${i + 1}/${totalChunks}:${checksum}:${payload}`);
    }
    setChunks(newChunks);
  }, [unsignedXdr]);

  useEffect(() => {
    if (chunks.length > 1) {
      const interval = setInterval(() => {
        setCurrentChunkIndex((prev) => (prev + 1) % chunks.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [chunks]);

  const handleSimulateScan = () => {
    // Simulate camera scanning a signed payload
    if (onSignedXdr) {
      onSignedXdr("AAAA-SIGNED-XDR-MOCK");
    }
  };

  const currentPayload = chunks.length > 0 ? chunks[currentChunkIndex] : JSON.stringify({
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
              <QRCodeSVG value={currentPayload} size={200} level="M" includeMargin={false} />
            </div>
            {chunks.length > 1 && (
              <p className="text-xs text-gray-400">
                Chunk {currentChunkIndex + 1} of {chunks.length}
              </p>
            )}
            <p className="text-xs text-gray-400 text-center max-w-xs">
              Scan with your air-gapped device to sign proposal #{proposalId}
            </p>
            
            <div className="mt-4 border-t border-gray-700 pt-4 w-full">
               <button
                 type="button"
                 onClick={handleSimulateScan}
                 className="flex items-center justify-center gap-2 w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white"
               >
                 <Scan size={16} /> Scan Signed QR from Device
               </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default QRSignature;
