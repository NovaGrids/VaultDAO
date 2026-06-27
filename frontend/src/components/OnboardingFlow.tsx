import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Link2, SkipForward } from 'lucide-react';
import {
  ONBOARDING_METRICS_KEY_PREFIX,
  ROLE_ONBOARDING_STEPS,
  type OnboardingRole,
  type RoleOnboardingStep,
  type StoredOnboardingMetrics,
} from '../constants/onboarding';
import { useOnboarding } from '../context/OnboardingProvider';
import { useWallet } from '../hooks/useWallet';

interface OnboardingFlowProps {
  onComplete?: () => void;
}

function normalizeRole(role: string | null): OnboardingRole {
  if (role === 'Admin' || role === 'Treasurer' || role === 'Member') return role;
  return 'Member';
}

function getMetricsKey(address: string | null): string | null {
  if (!address) return null;
  return `${ONBOARDING_METRICS_KEY_PREFIX}${address}`;
}

function readStoredMetrics(address: string | null): StoredOnboardingMetrics | null {
  const key = getMetricsKey(address);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredOnboardingMetrics;
  } catch {
    return null;
  }
}

function writeStoredMetrics(address: string | null, metrics: StoredOnboardingMetrics): void {
  const key = getMetricsKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(metrics));
  } catch {
    // ignore storage quota errors
  }
}

function markOnboardingDone(address: string | null): void {
  const key = getMetricsKey(address);
  if (!key) return;
  try {
    localStorage.setItem(`${key}_done`, 'true');
  } catch {
    // ignore
  }
}

function hasCompletedOnboarding(address: string | null): boolean {
  const key = getMetricsKey(address);
  if (!key) return false;
  try {
    return localStorage.getItem(`${key}_done`) === 'true';
  } catch {
    return false;
  }
}

function getTargetRect(selector: string): DOMRect | null {
  const node = document.querySelector(selector);
  if (!node) return null;
  return node.getBoundingClientRect();
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const { isOnboardingActive, skipOnboarding, completeStep } = useOnboarding();
  const { isConnected, address, accountRole } = useWallet();

  const role = useMemo(() => normalizeRole(accountRole), [accountRole]);
  const steps = useMemo(() => ROLE_ONBOARDING_STEPS[role], [role]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [skippedStepIds, setSkippedStepIds] = useState<string[]>([]);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep: RoleOnboardingStep | undefined = steps[currentStepIndex];
  const isWalletStep = currentStep?.id === 'wallet-link';
  const canSkipCurrent = Boolean(currentStep?.allowSkip) && !isWalletStep;

  const persistMetrics = useCallback(
    (nextStepIndex: number, nextCompleted: string[], nextSkipped: string[]) => {
      const metrics: StoredOnboardingMetrics = {
        role,
        currentStepIndex: nextStepIndex,
        completedStepIds: nextCompleted,
        skippedStepIds: nextSkipped,
        updatedAt: Date.now(),
      };
      writeStoredMetrics(address, metrics);
    },
    [address, role],
  );

  useEffect(() => {
    if (!isOnboardingActive || !address) return;

    if (hasCompletedOnboarding(address)) {
      skipOnboarding();
      return;
    }

    const stored = readStoredMetrics(address);
    if (!stored) return;

    if (stored.role !== role) {
      setCurrentStepIndex(0);
      setCompletedStepIds([]);
      setSkippedStepIds([]);
      persistMetrics(0, [], []);
      return;
    }

    setCurrentStepIndex(Math.min(stored.currentStepIndex, steps.length - 1));
    setCompletedStepIds(stored.completedStepIds);
    setSkippedStepIds(stored.skippedStepIds);
  }, [address, isOnboardingActive, role, steps.length, persistMetrics, skipOnboarding]);

  useEffect(() => {
    if (!isOnboardingActive || !currentStep) return;

    const updateRect = () => {
      setTargetRect(getTargetRect(currentStep.target));
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    const node = document.querySelector(currentStep.target);
    node?.classList.add('ring-2', 'ring-emerald-400', 'ring-offset-2', 'ring-offset-gray-950');

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      node?.classList.remove('ring-2', 'ring-emerald-400', 'ring-offset-2', 'ring-offset-gray-950');
    };
  }, [currentStep, isOnboardingActive]);

  useEffect(() => {
    if (!isOnboardingActive || !isConnected || !isWalletStep) return;
    setCurrentStepIndex((idx) => {
      const next = Math.min(idx + 1, steps.length - 1);
      persistMetrics(next, completedStepIds, skippedStepIds);
      return next;
    });
  }, [isConnected, isOnboardingActive, isWalletStep, steps.length, persistMetrics, completedStepIds, skippedStepIds]);

  if (!isOnboardingActive || !currentStep) return null;

  const totalSteps = steps.length;
  const isLastStep = currentStepIndex === totalSteps - 1;

  const finishFlow = () => {
    markOnboardingDone(address);
    skipOnboarding();
    onComplete?.();
  };

  const handleNext = () => {
    if (!currentStep) return;

    const nextCompleted = completedStepIds.includes(currentStep.id)
      ? completedStepIds
      : [...completedStepIds, currentStep.id];

    setCompletedStepIds(nextCompleted);
    completeStep(currentStep.id);

    if (isLastStep) {
      persistMetrics(currentStepIndex, nextCompleted, skippedStepIds);
      finishFlow();
      return;
    }

    const nextIndex = currentStepIndex + 1;
    setCurrentStepIndex(nextIndex);
    persistMetrics(nextIndex, nextCompleted, skippedStepIds);
  };

  const handleBack = () => {
    const nextIndex = Math.max(0, currentStepIndex - 1);
    setCurrentStepIndex(nextIndex);
    persistMetrics(nextIndex, completedStepIds, skippedStepIds);
  };

  const handleSkipForNow = () => {
    if (!canSkipCurrent || !currentStep) return;

    const nextSkipped = skippedStepIds.includes(currentStep.id)
      ? skippedStepIds
      : [...skippedStepIds, currentStep.id];

    setSkippedStepIds(nextSkipped);

    if (isLastStep) {
      persistMetrics(currentStepIndex, completedStepIds, nextSkipped);
      finishFlow();
      return;
    }

    const nextIndex = currentStepIndex + 1;
    setCurrentStepIndex(nextIndex);
    persistMetrics(nextIndex, completedStepIds, nextSkipped);
  };

  const tooltipTop = targetRect ? Math.max(targetRect.bottom + 12, 24) : 96;
  const tooltipLeft = targetRect ? Math.max(Math.min(targetRect.left, window.innerWidth - 360), 24) : 24;

  return (
    <div className="fixed inset-0 z-50" aria-live="polite" data-testid="onboarding-flow">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />

      {targetRect && (
        <div
          className="pointer-events-none fixed rounded-xl border border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      )}

      <div
        className="fixed w-[min(92vw,22rem)] rounded-xl border border-gray-700 bg-gray-900/95 p-5 text-gray-100 shadow-2xl contrast-more:border-white contrast-more:bg-black"
        style={{ top: tooltipTop, left: tooltipLeft }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">{role} onboarding</span>
          <span className="text-xs text-gray-400">{currentStepIndex + 1}/{totalSteps}</span>
        </div>

        <h2 className="text-lg font-semibold leading-tight">{currentStep.title}</h2>
        <p className="mt-2 text-sm text-gray-300">{currentStep.description}</p>

        {!targetRect && (
          <p className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
            Target element is not visible yet. Navigate to the related section and continue.
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStepIndex === 0}
            className="inline-flex items-center gap-1 rounded-md border border-gray-600 px-3 py-2 text-xs font-medium text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={14} />
            Back
          </button>

          {canSkipCurrent && (
            <button
              type="button"
              onClick={handleSkipForNow}
              className="inline-flex items-center gap-1 rounded-md border border-gray-600 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800"
            >
              <SkipForward size={14} />
              Skip for now
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={isWalletStep && !isConnected}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isWalletStep ? <Link2 size={14} /> : <ChevronRight size={14} />}
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow;
