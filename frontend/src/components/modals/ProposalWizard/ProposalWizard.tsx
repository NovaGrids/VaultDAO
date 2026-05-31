/**
 * ProposalWizard — 4-step proposal creation wizard.
 *
 * Steps:
 *  1. Basic Details  (recipient, token, amount, memo, priority)
 *  2. Conditions     (time locks, min balance, proposal dependencies)
 *  3. Insurance      (optional staking amount)
 *  4. Review         (transaction simulation preview + submit)
 *
 * Features:
 *  - react-hook-form for all form state, validated per step before advancing
 *  - Draft persisted to localStorage keyed by wallet address; restored on open
 *  - Draft cleared on successful submission
 *  - Glassmorphism progress bar
 *  - Fully keyboard-navigable and ARIA-labelled
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { X, ChevronLeft, ChevronRight, Send, Loader2 } from 'lucide-react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useVaultContract } from '../../../hooks/useVaultContract';
import type { SimulationResult } from '../../../utils/simulation';
import WizardProgressBar, { WIZARD_STEPS } from './WizardProgressBar';
import Step1BasicDetails from './Step1BasicDetails';
import Step2Conditions from './Step2Conditions';
import Step3Insurance from './Step3Insurance';
import Step4Review from './Step4Review';
import type { WizardFormData } from './schemas';
import { WIZARD_DEFAULTS } from './schemas';

// ─── Draft persistence ────────────────────────────────────────────────────────

const DRAFT_KEY_PREFIX = 'vaultdao_proposal_draft_';

function getDraftKey(walletAddress: string | null): string {
  return `${DRAFT_KEY_PREFIX}${walletAddress ?? 'anonymous'}`;
}

function loadDraft(walletAddress: string | null): Partial<WizardFormData> | null {
  try {
    const raw = localStorage.getItem(getDraftKey(walletAddress));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<WizardFormData>;
  } catch {
    return null;
  }
}

function saveDraft(walletAddress: string | null, data: WizardFormData): void {
  try {
    localStorage.setItem(getDraftKey(walletAddress), JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

function clearDraft(walletAddress: string | null): void {
  try {
    localStorage.removeItem(getDraftKey(walletAddress));
  } catch {
    // ignore
  }
}

// ─── Per-step field names for validation triggering ──────────────────────────

const STEP_FIELDS: Record<number, (keyof WizardFormData)[]> = {
  1: ['recipient', 'token', 'amount', 'memo', 'priority'],
  2: ['conditions', 'conditionLogic', 'dependsOnProposalId'],
  3: ['insuranceAmount', 'enableInsurance'],
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface ProposalWizardProps {
  isOpen: boolean;
  walletAddress: string | null;
  onClose: () => void;
  /** Called after successful on-chain submission. */
  onSuccess?: (txHash: string) => void;
}

const ProposalWizard: React.FC<ProposalWizardProps> = ({
  isOpen,
  walletAddress,
  onClose,
  onSuccess,
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const { proposeTransfer, simulateProposeTransfer } = useVaultContract();
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen);
  const announcerRef = useRef<HTMLDivElement>(null);

  // ── Form setup ──────────────────────────────────────────────────────────────
  const methods = useForm<WizardFormData>({
    mode: 'onTouched',
    defaultValues: WIZARD_DEFAULTS,
  });

  const { handleSubmit, trigger, watch, reset, getValues } = methods;

  // ── Restore draft on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const draft = loadDraft(walletAddress);
    if (draft) {
      reset({ ...WIZARD_DEFAULTS, ...draft });
    } else {
      reset(WIZARD_DEFAULTS);
    }
    setCurrentStep(1);
    setSubmitError(null);
    setSimulation(null);
    setSimulationError(null);
  }, [isOpen, walletAddress, reset]);

  // ── Auto-save draft on form changes ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const subscription = watch((data) => {
      saveDraft(walletAddress, data as WizardFormData);
    });
    return () => subscription.unsubscribe();
  }, [isOpen, walletAddress, watch]);

  // ── Keyboard: Escape to close ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // ── Announce step changes to screen readers ─────────────────────────────────
  const announceStep = useCallback((step: number) => {
    if (announcerRef.current) {
      announcerRef.current.textContent = `Step ${step} of ${WIZARD_STEPS.length}: ${
        WIZARD_STEPS[step - 1]?.label ?? ''
      }`;
    }
  }, []);

  // ── Run simulation when reaching step 4 ────────────────────────────────────
  const runSimulation = useCallback(async () => {
    const data = getValues();
    setSimulating(true);
    setSimulationError(null);
    setSimulation(null);
    try {
      const result = await simulateProposeTransfer(
        data.recipient,
        data.token,
        data.amount,
        data.memo ?? '',
        parseInt(data.priority) as 0 | 1 | 2,
        [],
        parseInt(data.conditionLogic) as 0 | 1,
        data.enableInsurance ? BigInt(Math.round(parseFloat(data.insuranceAmount || '0') * 1e7)) : 0n,
      );
      setSimulation(result);
    } catch (err) {
      setSimulationError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  }, [getValues, simulateProposeTransfer]);

  // ── Step navigation ─────────────────────────────────────────────────────────
  const goToStep = useCallback(
    async (targetStep: number) => {
      if (targetStep > currentStep) {
        // Validate current step fields before advancing
        const fieldsToValidate = STEP_FIELDS[currentStep] ?? [];
        const valid = await trigger(fieldsToValidate);
        if (!valid) return;
      }

      setCurrentStep(targetStep);
      announceStep(targetStep);

      // Trigger simulation when entering review step
      if (targetStep === 4) {
        void runSimulation();
      }
    },
    [currentStep, trigger, announceStep, runSimulation],
  );

  const handleNext = useCallback(() => goToStep(currentStep + 1), [currentStep, goToStep]);
  const handleBack = useCallback(() => {
    setCurrentStep((s) => s - 1);
    announceStep(currentStep - 1);
  }, [currentStep, announceStep]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const onSubmit = handleSubmit(async (data) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const insuranceAmt = data.enableInsurance
        ? BigInt(Math.round(parseFloat(data.insuranceAmount || '0') * 1e7))
        : 0n;

      const txHash = await proposeTransfer(
        data.recipient,
        data.token,
        data.amount,
        data.memo ?? '',
        parseInt(data.priority) as 0 | 1 | 2,
        [],
        parseInt(data.conditionLogic) as 0 | 1,
        insuranceAmt,
      );

      // Clear draft on success
      clearDraft(walletAddress);
      onSuccess?.(txHash ?? '');
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  });

  if (!isOpen) return null;

  const isLastStep = currentStep === WIZARD_STEPS.length;
  const isFirstStep = currentStep === 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
    >
      {/* Screen reader live region for step announcements */}
      <div
        ref={announcerRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <div
        ref={modalRef}
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-gray-900/95 shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
            <h2 id="wizard-title" className="text-xl font-bold text-white">
              Create Proposal
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Draft auto-saved
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Close proposal wizard"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pb-4 flex-shrink-0">
          <WizardProgressBar currentStep={currentStep} />
        </div>

        {/* Step content */}
        <FormProvider {...methods}>
          <form
            id="proposal-wizard-form"
            onSubmit={onSubmit}
            noValidate
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="flex-1 overflow-y-auto px-6 py-2">
              {/* Step panels */}
              <div
                role="tabpanel"
                aria-labelledby={`wizard-step-${currentStep}-tab`}
                id={`wizard-step-${currentStep}-panel`}
              >
                {currentStep === 1 && <Step1BasicDetails />}
                {currentStep === 2 && <Step2Conditions />}
                {currentStep === 3 && <Step3Insurance />}
                {currentStep === 4 && (
                  <Step4Review
                    simulation={simulation}
                    simulating={simulating}
                    simulationError={simulationError}
                  />
                )}
              </div>
            </div>

            {/* Submit error */}
            {submitError && (
              <div
                role="alert"
                className="mx-6 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              >
                {submitError}
              </div>
            )}

            {/* Footer navigation */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-700/50 flex-shrink-0">
              <button
                type="button"
                onClick={handleBack}
                disabled={isFirstStep}
                className="flex items-center gap-2 rounded-xl border border-gray-600 bg-gray-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                aria-label={isFirstStep ? 'Already on first step' : 'Go to previous step'}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Back
              </button>

              <div className="flex items-center gap-2">
                {/* Step indicator (mobile) */}
                <span className="text-xs text-gray-500 sm:hidden">
                  {currentStep}/{WIZARD_STEPS.length}
                </span>

                {isLastStep ? (
                  <button
                    type="submit"
                    form="proposal-wizard-form"
                    disabled={submitting}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:from-purple-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-purple-500 active:scale-[0.98]"
                    aria-label={submitting ? 'Submitting proposal…' : 'Sign and submit proposal'}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Send size={16} aria-hidden="true" />
                        Sign & Submit
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 active:scale-[0.98]"
                    aria-label={`Continue to step ${currentStep + 1}: ${WIZARD_STEPS[currentStep]?.label}`}
                  >
                    Next
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </form>
        </FormProvider>
      </div>
    </div>
  );
};

export default ProposalWizard;
