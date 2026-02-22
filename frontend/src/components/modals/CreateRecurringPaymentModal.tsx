import React, { useState, useMemo } from 'react';
import { Clock, AlertCircle } from 'lucide-react';

export interface CreateRecurringPaymentFormData {
  recipient: string;
  token: string;
  amount: string;
  memo: string;
  interval: number; // in seconds
}

interface CreateRecurringPaymentModalProps {
  isOpen: boolean;
  loading: boolean;
  formData: CreateRecurringPaymentFormData;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onFieldChange: (field: keyof CreateRecurringPaymentFormData, value: string | number) => void;
}

// Interval presets in seconds
const INTERVAL_PRESETS = [
  { label: 'Hourly', value: 3600, description: 'Every hour' },
  { label: 'Daily', value: 86400, description: 'Every 24 hours' },
  { label: 'Weekly', value: 604800, description: 'Every 7 days' },
  { label: 'Monthly', value: 2592000, description: 'Every 30 days' },
];

// Custom interval options
const CUSTOM_INTERVAL_UNITS = [
  { label: 'Hours', value: 3600 },
  { label: 'Days', value: 86400 },
  { label: 'Weeks', value: 604800 },
];

const CreateRecurringPaymentModal: React.FC<CreateRecurringPaymentModalProps> = ({
  isOpen,
  loading,
  formData,
  onClose,
  onSubmit,
  onFieldChange,
}) => {
  const [useCustomInterval, setUseCustomInterval] = useState(false);
  const [customIntervalValue, setCustomIntervalValue] = useState('1');
  const [customIntervalUnit, setCustomIntervalUnit] = useState(86400); // Default to days
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Calculate next payment preview
  const nextPaymentPreview = useMemo(() => {
    if (!formData.interval || formData.interval <= 0) return null;
    
    const diffMs = formData.interval * 1000;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    
    if (days > 0) {
      return `Next payment in ${days} day${days > 1 ? 's' : ''}${remainingHours > 0 ? ` ${remainingHours} hour${remainingHours > 1 ? 's' : ''}` : ''}`;
    }
    return `Next payment in ${hours} hour${hours > 1 ? 's' : ''}`;
  }, [formData.interval]);

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate recipient address (Stellar public key format)
    if (!formData.recipient.trim()) {
      newErrors.recipient = 'Recipient address is required';
    } else if (!/^G[A-Z2-7]{55}$/.test(formData.recipient.trim())) {
      newErrors.recipient = 'Invalid Stellar public key format';
    }

    // Validate token address
    if (!formData.token.trim()) {
      newErrors.token = 'Token address is required';
    } else if (!/^C[A-Z2-7]{55}$/.test(formData.token.trim()) && formData.token !== 'native') {
      newErrors.token = 'Invalid token contract address';
    }

    // Validate amount
    if (!formData.amount.trim()) {
      newErrors.amount = 'Amount is required';
    } else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
      newErrors.amount = 'Amount must be a positive number';
    }

    // Validate interval
    if (!formData.interval || formData.interval <= 0) {
      newErrors.interval = 'Please select or set a valid interval';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(e);
    }
  };

  const handlePresetSelect = (value: number) => {
    setUseCustomInterval(false);
    onFieldChange('interval', value);
  };

  const handleCustomIntervalChange = () => {
    const value = parseInt(customIntervalValue, 10);
    if (value > 0) {
      const totalSeconds = value * customIntervalUnit;
      onFieldChange('interval', totalSeconds);
    }
  };

  // Format interval for display
  const formatInterval = (seconds: number): string => {
    if (seconds >= 2592000) {
      const months = Math.round(seconds / 2592000);
      return `Every ${months} month${months > 1 ? 's' : ''}`;
    }
    if (seconds >= 604800) {
      const weeks = Math.round(seconds / 604800);
      return `Every ${weeks} week${weeks > 1 ? 's' : ''}`;
    }
    if (seconds >= 86400) {
      const days = Math.round(seconds / 86400);
      return `Every ${days} day${days > 1 ? 's' : ''}`;
    }
    const hours = Math.round(seconds / 3600);
    return `Every ${hours} hour${hours > 1 ? 's' : ''}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 sm:p-6 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Clock className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">Create Recurring Payment</h3>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <span className="sr-only">Close</span>
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6">
          {/* Recipient Address */}
          <div>
            <label htmlFor="recipient" className="block text-sm font-medium text-gray-300 mb-2">
              Recipient Address
            </label>
            <input
              type="text"
              id="recipient"
              value={formData.recipient}
              onChange={(e) => onFieldChange('recipient', e.target.value)}
              placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                errors.recipient ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {errors.recipient && (
              <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.recipient}
              </p>
            )}
          </div>

          {/* Token Address */}
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-300 mb-2">
              Token Address
            </label>
            <input
              type="text"
              id="token"
              value={formData.token}
              onChange={(e) => onFieldChange('token', e.target.value)}
              placeholder="CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX or 'native' for XLM"
              className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                errors.token ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {errors.token && (
              <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.token}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">Use 'native' for XLM or enter a token contract address</p>
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-300 mb-2">
              Amount (in stroops)
            </label>
            <input
              type="text"
              id="amount"
              value={formData.amount}
              onChange={(e) => onFieldChange('amount', e.target.value)}
              placeholder="1000000000 (100 XLM)"
              className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                errors.amount ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {errors.amount && (
              <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.amount}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">1 XLM = 10,000,000 stroops</p>
          </div>

          {/* Memo */}
          <div>
            <label htmlFor="memo" className="block text-sm font-medium text-gray-300 mb-2">
              Memo (Optional)
            </label>
            <textarea
              id="memo"
              value={formData.memo}
              onChange={(e) => onFieldChange('memo', e.target.value)}
              placeholder="Payment description or reference"
              rows={2}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors resize-none"
            />
          </div>

          {/* Interval Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Payment Interval
            </label>
            
            {/* Preset Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {INTERVAL_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handlePresetSelect(preset.value)}
                  className={`px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                    !useCustomInterval && formData.interval === preset.value
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-gray-800 text-gray-300 border border-gray-600 hover:border-purple-500/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Interval */}
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setUseCustomInterval(true)}
                className={`text-sm font-medium transition-colors ${
                  useCustomInterval ? 'text-purple-400' : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Custom interval
              </button>
            </div>

            {useCustomInterval && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="number"
                  min="1"
                  value={customIntervalValue}
                  onChange={(e) => {
                    setCustomIntervalValue(e.target.value);
                    setTimeout(handleCustomIntervalChange, 0);
                  }}
                  onBlur={handleCustomIntervalChange}
                  placeholder="1"
                  className="flex-1 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <select
                  value={customIntervalUnit}
                  onChange={(e) => {
                    setCustomIntervalUnit(Number(e.target.value));
                    setTimeout(handleCustomIntervalChange, 0);
                  }}
                  className="px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {CUSTOM_INTERVAL_UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {errors.interval && (
              <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.interval}
              </p>
            )}
          </div>

          {/* Preview */}
          {formData.interval > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-300">
                <Clock className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium">Schedule Preview</span>
              </div>
              <div className="mt-2 space-y-1">
                <p className="text-white font-medium">{formatInterval(formData.interval)}</p>
                {nextPaymentPreview && (
                  <p className="text-sm text-gray-400">{nextPaymentPreview}</p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 sm:flex-none px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 sm:flex-none px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating...
                </>
              ) : (
                <>
                  <Clock className="w-5 h-5" />
                  Create Recurring Payment
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateRecurringPaymentModal;
