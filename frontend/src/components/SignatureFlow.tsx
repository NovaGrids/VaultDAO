import React, { useState } from "react";
import { CheckCircle2, Circle, Clock, ChevronLeft, ChevronRight, Shield } from "lucide-react";
import TransactionSimulator from "./TransactionSimulator";
import QRSignature from "./QRSignature";
import { useVaultContract } from "../hooks/useVaultContract";

export interface ProposalDetails {
  id: number;
  recipient: string;
  amount: string;
  token: string;
  memo: string;
  approvalCount: number;
  threshold: number;
  alreadyApproved: boolean;
}

interface SignatureFlowProps {
  proposal: ProposalDetails;
  onComplete?: () => void;
  onCancel?: () => void;
}

const STEPS = ["Review", "Simulate", "Sign"];

const SignatureFlow: React.FC<SignatureFlowProps> = ({ proposal, onComplete, onCancel }) => {
  const [step, setStep] = useState(0);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const { approveProposal } = useVaultContract();

  const handleSignedXdr = async (xdr: string) => {
    setSigning(true);
    setSignError(null);
    try {
      // Decode and submit signed XDR here
      console.log("Submitting signed XDR:", xdr);
      await approveProposal(proposal.id);
      setSigned(true);
      onComplete?.();
    } catch (e: any) {
      setSignError(e.message || "Failed to submit signed transaction");
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${i < step ? "bg-green-500 border-green-500 text-white" : i === step ? "border-purple-500 text-purple-400" : "border-gray-600 text-gray-500"}`}>
                {i < step ? <CheckCircle2 size={16} /> : i === step ? <Clock size={16} className="animate-pulse" /> : <Circle size={16} />}
              </div>
              <span className={`text-[10px] uppercase tracking-wide ${i === step ? "text-purple-400" : "text-gray-500"}`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mb-4 ${i < step ? "bg-green-500" : "bg-gray-700"}`} />}
          </React.Fragment>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-3 bg-gray-800/40 rounded-xl border border-gray-700 p-4">
          <h3 className="text-sm font-bold text-white">Proposal Details</h3>
          {/* Details */}
        </div>
      )}

      {step === 1 && (
        <TransactionSimulator
          proposalId={proposal.id}
          functionName="approve_proposal"
          args={[]}
          actionLabel="Proceed to Sign"
          onProceed={() => setStep(2)}
          onCancel={onCancel}
        />
      )}

      {step === 2 && (
        <div className="space-y-4">
          {signed ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 size={36} className="text-green-500" />
              <p className="text-white font-semibold">Proposal Approved</p>
            </div>
          ) : (
            <QRSignature
              proposalId={proposal.id}
              contractAddress="CA_MOCK_ADDRESS"
              unsignedXdr="AAAA-UNSIGNED-MOCK-XDR-PAYLOAD-THAT-IS-VERY-LONG-FOR-TESTING"
              onSignedXdr={handleSignedXdr}
              signed={signed}
            />
          )}
          {signError && <p className="text-red-400 text-sm mt-2">{signError}</p>}
        </div>
      )}

      {!signed && (
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => (step === 0 ? onCancel?.() : setStep(step - 1))} className="px-4 py-2 bg-gray-700 text-white rounded-lg">Back</button>
          {step < 2 && <button type="button" onClick={() => setStep(step + 1)} className="px-4 py-2 bg-purple-600 text-white rounded-lg ml-auto">Next</button>}
        </div>
      )}
    </div>
  );
};

export default SignatureFlow;
