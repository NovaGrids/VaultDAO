import React, { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import TransactionSimulator from "./TransactionSimulator";
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

const SignatureFlow: React.FC<SignatureFlowProps> = ({
  proposal,
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState(0);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const { approveProposal } = useVaultContract();

  const handleSign = async () => {
    setSigning(true);
    setSignError(null);
    try {
      await approveProposal(proposal.id);
      setSigned(true);
      onComplete?.();
    } catch (e: unknown) {
      setSignError(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setSigning(false);
    }
  };

  if (proposal.alreadyApproved) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2 size={40} className="text-green-500" />
        <p className="text-white font-semibold">Already Approved</p>
        <p className="text-sm text-gray-400">
          You have already signed this proposal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  i < step
                    ? "bg-green-500 border-green-500 text-white"
                    : i === step
                      ? "border-purple-500 text-purple-400"
                      : "border-gray-600 text-gray-500"
                }`}
              >
                {i < step ? (
                  <CheckCircle2 size={16} />
                ) : i === step ? (
                  <Clock size={16} className="animate-pulse" />
                ) : (
                  <Circle size={16} />
                )}
              </div>
              <span
                className={`text-[10px] uppercase tracking-wide ${i === step ? "text-purple-400" : "text-gray-500"}`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mb-4 ${i < step ? "bg-green-500" : "bg-gray-700"}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Approval progress */}
      <div className="flex items-center gap-2 text-sm">
        <Shield size={16} className="text-purple-400" />
        <span className="text-gray-400">Approvals:</span>
        <span className="text-white font-bold">
          {proposal.approvalCount} of {proposal.threshold}
        </span>
      </div>

      {/* Step content */}
      {step === 0 && (
        <div className="space-y-3 bg-gray-800/40 rounded-xl border border-gray-700 p-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Proposal Details
          </h3>
          {[
            ["Recipient", proposal.recipient],
            ["Amount", proposal.amount],
            ["Token", proposal.token],
            ["Memo", proposal.memo],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="text-white font-mono truncate max-w-[60%] text-right">
                {value}
              </span>
            </div>
          ))}
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
            <>
              {signError && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                  {signError}
                </p>
              )}
              <button
                type="button"
                onClick={handleSign}
                disabled={signing}
                className="w-full min-h-[44px] rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
              >
                {signing ? "Approving in Wallet…" : "Approve in Wallet"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Navigation */}
      {!signed && (
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => (step === 0 ? onCancel?.() : setStep(step - 1))}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white min-h-[40px]"
          >
            <ChevronLeft size={16} /> {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < 2 && (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-sm text-white ml-auto min-h-[40px]"
            >
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SignatureFlow;
