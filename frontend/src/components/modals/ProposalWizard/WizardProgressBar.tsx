import React from 'react';
import { Check } from 'lucide-react';

export interface WizardStep {
  id: number;
  label: string;
  description: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  { id: 1, label: 'Basic Details', description: 'Recipient, token, amount' },
  { id: 2, label: 'Conditions', description: 'Dependencies & logic' },
  { id: 3, label: 'Insurance', description: 'Staking & coverage' },
  { id: 4, label: 'Review', description: 'Preview & submit' },
];

interface WizardProgressBarProps {
  currentStep: number; // 1-indexed
}

const WizardProgressBar: React.FC<WizardProgressBarProps> = ({ currentStep }) => {
  return (
    <nav aria-label="Proposal creation progress" className="w-full">
      {/* Glassmorphism container */}
      <div className="relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-4 sm:px-6">
        <ol className="flex items-center justify-between" role="list">
          {WIZARD_STEPS.map((step, index) => {
            const isCompleted = currentStep > step.id;
            const isCurrent = currentStep === step.id;
            const isUpcoming = currentStep < step.id;

            return (
              <li
                key={step.id}
                className="flex flex-1 flex-col items-center relative"
                aria-current={isCurrent ? 'step' : undefined}
              >
                {/* Connector line (not for first item) */}
                {index > 0 && (
                  <div
                    className={`absolute left-0 top-5 h-0.5 w-full -translate-x-1/2 transition-colors duration-500 ${
                      isCompleted ? 'bg-purple-500' : 'bg-gray-700'
                    }`}
                    aria-hidden="true"
                  />
                )}

                {/* Step circle */}
                <div
                  className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    isCompleted
                      ? 'border-purple-500 bg-purple-500 text-white shadow-lg shadow-purple-500/30'
                      : isCurrent
                      ? 'border-purple-400 bg-purple-500/20 text-purple-300 shadow-lg shadow-purple-500/20 ring-4 ring-purple-500/20'
                      : 'border-gray-600 bg-gray-800/60 text-gray-500'
                  }`}
                >
                  {isCompleted ? (
                    <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                  ) : (
                    <span className="text-sm font-semibold" aria-hidden="true">
                      {step.id}
                    </span>
                  )}
                  <span className="sr-only">
                    Step {step.id}: {step.label} —{' '}
                    {isCompleted ? 'completed' : isCurrent ? 'current' : 'upcoming'}
                  </span>
                </div>

                {/* Step label */}
                <div className="mt-2 hidden sm:flex flex-col items-center text-center">
                  <span
                    className={`text-xs font-semibold transition-colors ${
                      isCurrent
                        ? 'text-purple-300'
                        : isCompleted
                        ? 'text-gray-300'
                        : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>
                  <span className="text-[10px] text-gray-600 mt-0.5">{step.description}</span>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Mobile: current step label */}
        <p className="mt-3 text-center text-sm font-medium text-purple-300 sm:hidden">
          Step {currentStep} of {WIZARD_STEPS.length}:{' '}
          {WIZARD_STEPS[currentStep - 1]?.label}
        </p>
      </div>
    </nav>
  );
};

export default WizardProgressBar;
