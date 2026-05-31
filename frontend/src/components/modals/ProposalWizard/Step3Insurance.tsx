import React from 'react';
import { useFormContext } from 'react-hook-form';
import { AlertCircle, Shield, ShieldOff } from 'lucide-react';
import type { WizardFormData } from './schemas';
import { step3Validators } from './schemas';

const FieldError: React.FC<{ message?: string }> = ({ message }) => {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle size={12} aria-hidden="true" />
      {message}
    </p>
  );
};

const Step3Insurance: React.FC = () => {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<WizardFormData>();

  const enableInsurance = watch('enableInsurance');

  return (
    <fieldset className="space-y-6">
      <legend className="sr-only">Insurance and staking settings</legend>

      {/* Insurance toggle */}
      <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 rounded-xl p-2 transition-colors ${
                enableInsurance
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-gray-700/60 text-gray-500'
              }`}
              aria-hidden="true"
            >
              {enableInsurance ? <Shield size={20} /> : <ShieldOff size={20} />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Insurance Coverage</h3>
              <p className="mt-1 text-xs text-gray-400 max-w-sm">
                Stake an insurance amount that will be slashed if this proposal is found to
                violate governance rules. Adds credibility to high-value proposals.
              </p>
            </div>
          </div>

          {/* Toggle switch */}
          <label className="relative inline-flex cursor-pointer items-center flex-shrink-0">
            <input
              type="checkbox"
              role="switch"
              aria-checked={enableInsurance}
              aria-label="Enable insurance coverage"
              className="sr-only peer"
              {...register('enableInsurance')}
            />
            <div className="h-6 w-11 rounded-full bg-gray-700 transition-colors peer-checked:bg-purple-600 peer-focus:ring-2 peer-focus:ring-purple-500 peer-focus:ring-offset-2 peer-focus:ring-offset-gray-900" />
            <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </label>
        </div>
      </div>

      {/* Insurance amount (only shown when enabled) */}
      {enableInsurance && (
        <div
          className="animate-in fade-in slide-in-from-top-2 duration-200"
          role="region"
          aria-label="Insurance amount settings"
        >
          <label
            htmlFor="wizard-insurance-amount"
            className="block text-sm font-semibold text-gray-300 mb-1.5"
          >
            Insurance Amount (XLM){' '}
            <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <p className="mb-2 text-xs text-gray-500">
            This amount will be locked from your wallet as a stake. It is returned if the
            proposal executes successfully.
          </p>
          <input
            id="wizard-insurance-amount"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            aria-required="true"
            aria-describedby={
              errors.insuranceAmount ? 'wizard-insurance-error' : 'wizard-insurance-hint'
            }
            aria-invalid={!!errors.insuranceAmount}
            className={`w-full rounded-xl border bg-gray-800/60 px-4 py-3 text-sm text-white placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
              errors.insuranceAmount
                ? 'border-red-500'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            {...register('insuranceAmount', {
              validate: step3Validators.insuranceAmount,
            })}
          />
          <p id="wizard-insurance-hint" className="mt-1 text-xs text-gray-500">
            Minimum: 0 XLM (no insurance). Recommended: 5–10% of proposal amount.
          </p>
          <FieldError message={errors.insuranceAmount?.message} />
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <p className="text-xs text-blue-300">
          <strong>Note:</strong> Insurance is optional for all proposals. For proposals above
          the vault's spending limit, insurance may be required by governance rules.
        </p>
      </div>
    </fieldset>
  );
};

export default Step3Insurance;
