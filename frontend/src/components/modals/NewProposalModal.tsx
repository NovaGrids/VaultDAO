import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { X, AlertCircle, Loader2,CheckCircle } from 'lucide-react';
import TokenSelector from '../TokenSelector';
import type { TokenBalance } from '../TokenBalanceCard';
import type { TokenInfo } from '../../constants/tokens';
import { formatTokenBalance } from '../../constants/tokens';       
import { isValidStellarAddress, isValidContractAddress, formatAmount } from '../../utils/proposalValidation';

export interface NewProposalFormData {
  recipient: string;
  token: string;
  amount: string;
  memo: string;
}

interface ValidationErrors {
  recipient?: string;
  token?: string;
  amount?: string;
}

interface NewProposalModalProps {
  isOpen: boolean;
  loading: boolean;
  selectedTemplateName: string | null;
  formData: NewProposalFormData;
  tokenBalances: TokenBalance[];
  selectedToken: TokenInfo | null;
  amountError: string | null;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onFieldChange: (field: keyof NewProposalFormData, value: string) => void;
  onTokenSelect: (token: TokenInfo) => void;
  onOpenTemplateSelector: () => void;
  onSaveAsTemplate: () => void;
  onAddCustomToken?: (address: string) => Promise<TokenInfo | null>;
  submitError?: string | null;
}

// Validation status indicator component
const ValidationIndicator: React.FC<{ status: 'valid' | 'invalid' | 'empty' | 'pending' }> = ({ status }) => {
  if (status === 'empty') return null;
  
  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2">
      {status === 'valid' && (
        <CheckCircle className="h-5 w-5 text-green-500" aria-label="Valid" />
      )}
      {status === 'invalid' && (
        <AlertCircle className="h-5 w-5 text-red-500" aria-label="Invalid" />
      )}
      {status === 'pending' && (
        <Loader2 className="h-5 w-5 text-gray-400 animate-spin" aria-label="Checking..." />
      )}
    </div>
  );
};

const NewProposalModal: React.FC<NewProposalModalProps> = ({
  isOpen,
  loading,
  selectedTemplateName,
  formData,
  tokenBalances,
  selectedToken,
  amountError,
  onClose,
  onSubmit,
  onFieldChange,
  onTokenSelect,
  onOpenTemplateSelector,
  onSaveAsTemplate,
  onAddCustomToken,
}) => {
  // Find the selected token from balances
  const selectedTokenBalance = React.useMemo(() => {
    if (!selectedToken) return null;
    return tokenBalances.find(tb => tb.token.address === selectedToken.address);
  }, [tokenBalances, selectedToken]);

  const handleTokenSelect = (token: TokenInfo) => {
    onFieldChange('token', token.address);
    onTokenSelect(token);
  };

  const handleAmountChange = (value: string) => {
    // Only allow numbers and decimal point
    const sanitized = value.replace(/[^0-9.]/g, '');
    // Prevent multiple decimal points
    const parts = sanitized.split('.');
    const formatted = parts.length > 2 
      ? `${parts[0]}.${parts.slice(1).join('')}`
      : sanitized;
    
    onFieldChange('amount', formatted);
  };

  // Set max amount
  const handleSetMax = () => {
    if (selectedTokenBalance) {
      onFieldChange('amount', selectedTokenBalance.balance);
    }
  };

  submitError,
}) => {
  const [touched, setTouched] = useState<Record<keyof NewProposalFormData, boolean>>({
    recipient: false,
    token: false,
    amount: false,
    memo: false,
  });
  
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  
  // Track previous isOpen state to detect when modal opens
  const prevIsOpenRef = useRef(isOpen);

  // Validate form fields
  const validateField = useCallback((field: keyof NewProposalFormData, value: string): string | undefined => {
    switch (field) {
      case 'recipient':
        if (!value.trim()) return 'Recipient address is required';
        if (!isValidStellarAddress(value)) {
          return 'Invalid Stellar address (must start with G and be 56 characters)';
        }
        return undefined;
      
      case 'token':
        if (!value.trim()) return 'Token address is required';
        if (!isValidContractAddress(value)) {
          return 'Invalid token address (use NATIVE, a valid contract address starting with C, or a Stellar address)';
        }
        return undefined;
      
      case 'amount': {
        if (!value.trim()) return 'Amount is required';
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue <= 0) {
          return 'Amount must be a positive number greater than 0';
        }
        if (numValue > 1000000000000) {
          return 'Amount exceeds maximum allowed value';
        }
        return undefined;
      }
      
      case 'memo':
        // Memo is optional, no validation needed
        return undefined;
      
      default:
        return undefined;
    }
  }, []);

  // Validate all fields and return errors (without setting state)
  const getValidationErrors = useCallback((data: NewProposalFormData): ValidationErrors => {
    const errors: ValidationErrors = {};
    (['recipient', 'token', 'amount'] as const).forEach(field => {
      const error = validateField(field, data[field]);
      if (error) errors[field] = error;
    });
    return errors;
  }, [validateField]);

  // Compute validation errors based on form data and touched state
  const computedErrors = useMemo(() => {
    if (!touched.recipient && !touched.token && !touched.amount) {
      return {};
    }
    return getValidationErrors(formData);
  }, [formData, touched, getValidationErrors]);

  // Update validation errors state when computed errors change
  useEffect(() => {
    setValidationErrors(computedErrors);
  }, [computedErrors]);

  // Handle field blur for validation
  const handleBlur = (field: keyof NewProposalFormData) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  // Handle amount change with formatting
  const handleAmountChange = (value: string) => {
    const formatted = formatAmount(value);
    onFieldChange('amount', formatted);
  };

  // Check if form is valid
  const isFormValid = useMemo(() => {
    return (
      isValidStellarAddress(formData.recipient) &&
      isValidContractAddress(formData.token) &&
      formData.amount &&
      parseFloat(formData.amount) > 0
    );
  }, [formData]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Touch all fields to show validation
    setTouched({
      recipient: true,
      token: true,
      amount: true,
      memo: true,
    });
    
    const errors = getValidationErrors(formData);
    setValidationErrors(errors);
    
    if (Object.keys(errors).length === 0) {
      onSubmit(e);
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, loading, onClose]);

  // Reset touched state when modal opens (using ref to detect transition)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setTouched({
        recipient: false,
        token: false,
        amount: false,
        memo: false,
      });
      setValidationErrors({});
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-4 sm:p-6 my-4">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-semibold text-white">Create New Proposal</h3>
          <div className="flex items-center gap-2">
            {selectedTemplateName ? (
              <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-xs text-purple-300">
                Template: {selectedTemplateName}
              </span>
            ) : null}
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 sm:hidden"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Recipient Address */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Recipient Address</label>
            <input
              type="text"
              value={formData.recipient}
              onChange={(event) => onFieldChange('recipient', event.target.value)}
              placeholder="G... or C... (Stellar address)"
              className="w-full rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>

          {/* Token Selector */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Select Token</label>
            <TokenSelector
              tokens={tokenBalances}
              selectedToken={selectedToken}
              onSelect={handleTokenSelect}
              onAddCustomToken={onAddCustomToken}
              showBalance={true}
              placeholder="Select a token"
            />
          </div>

          {/* Amount Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-gray-400">Amount</label>
              {selectedTokenBalance && (
                <button
                  type="button"
                  onClick={handleSetMax}
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  Max: {formatTokenBalance(selectedTokenBalance.balance, selectedTokenBalance.token.decimals)} {selectedTokenBalance.token.symbol}
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="text"
                value={formData.amount}
                onChange={(event) => handleAmountChange(event.target.value)}
                placeholder="0.00"
                className={`w-full rounded-lg border bg-gray-800 px-4 py-3 pr-16 text-sm text-white placeholder-gray-500 focus:outline-none ${
                  amountError ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-purple-500'
                }`}
              />
              {selectedToken && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  {selectedToken.symbol}
                </span>
              )}
            </div>
            {amountError && (
              <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
                <AlertCircle size={14} />
                <span>{amountError}</span>
              </div>
            )}
          </div>

          {/* Memo */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Memo (Optional)</label>
            <textarea
              value={formData.memo}
              onChange={(event) => onFieldChange('memo', event.target.value)}
              placeholder="Add a description or note for this proposal..."
              rows={3}
              className="w-full rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none resize-none"
            />
          </div>

          {/* Selected Token Info */}
          {selectedTokenBalance && formData.amount && !amountError && (
            <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">You're sending</span>
                <span className="text-white font-medium">
                  {formatTokenBalance(formData.amount, selectedTokenBalance.token.decimals)} {selectedTokenBalance.token.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-500">Remaining balance after transfer</span>
                <span className="text-gray-400">
                  {formatTokenBalance(
                    Math.max(0, parseFloat(selectedTokenBalance.balance) - parseFloat(formData.amount)).toString(),
                    selectedTokenBalance.token.decimals
                  )} {selectedTokenBalance.token.symbol}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between pt-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onOpenTemplateSelector}
                className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
              >
                Use Template
              </button>
              <button
                type="button"
                onClick={onSaveAsTemplate}
                className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
              >
                Save as Template
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !!amountError || !formData.recipient || !formData.amount}
                className="min-h-[44px] rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  'Submit Proposal'
                )}
              </button>
            </div>
            {touched.token && validationErrors.token && (
              <p id="token-error" className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="h-3 w-3" />
                {validationErrors.token}
              </p>
            )}
            <p className="text-xs text-gray-500">
              Use NATIVE for XLM, or enter a valid contract/token address
            </p>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <label htmlFor="amount" className="block text-sm font-medium text-gray-300">
              Amount <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                id="amount"
                type="text"
                inputMode="decimal"
                value={formData.amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onBlur={() => handleBlur('amount')}
                placeholder="0.0000000"
                disabled={loading}
                className={`w-full rounded-lg border bg-gray-800 px-3 py-3 pr-10 text-sm text-white placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 min-h-[44px] ${
                  touched.amount && validationErrors.amount
                    ? 'border-red-500 focus:border-red-500'
                    : touched.amount && !validationErrors.amount
                    ? 'border-green-500 focus:border-green-500'
                    : 'border-gray-600 focus:border-purple-500'
                }`}
                aria-describedby={validationErrors.amount ? 'amount-error' : 'amount-hint'}
                aria-invalid={touched.amount && !!validationErrors.amount}
              />
              <ValidationIndicator 
                status={
                  !touched.amount ? 'empty' :
                  validationErrors.amount ? 'invalid' : 'valid'
                } 
              />
            </div>
            {touched.amount && validationErrors.amount && (
              <p id="amount-error" className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="h-3 w-3" />
                {validationErrors.amount}
              </p>
            )}
            <p id="amount-hint" className="text-xs text-gray-500">
              Enter amount with up to 7 decimal places (Stellar precision)
            </p>
          </div>

          {/* Memo */}
          <div className="space-y-2">
            <label htmlFor="memo" className="block text-sm font-medium text-gray-300">
              Memo <span className="text-gray-500">(optional)</span>
            </label>
            <textarea
              id="memo"
              value={formData.memo}
              onChange={(e) => onFieldChange('memo', e.target.value)}
              onBlur={() => handleBlur('memo')}
              placeholder="Add a description or note for this proposal..."
              disabled={loading}
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-600 bg-gray-800 px-3 py-3 text-sm text-white placeholder-gray-500 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
          </div>

          {/* Submit Error */}
          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {submitError}
              </p>
            </div>
          )}

          {/* Template Actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <button
              type="button"
              onClick={onOpenTemplateSelector}
              disabled={loading}
              className="min-h-[44px] flex-1 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use Template
            </button>
            <button
              type="button"
              onClick={onSaveAsTemplate}
              disabled={loading || !isFormValid}
              className="min-h-[44px] flex-1 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save as Template
            </button>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || !isFormValid}
            className="min-h-[44px] w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating Proposal...
              </span>
            ) : (
              'Create Proposal'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default NewProposalModal;
