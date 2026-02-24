import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search, Plus, X, Loader2, AlertCircle, Check } from 'lucide-react';
import type { TokenInfo } from '../constants/tokens';
import { getTokenIcon, isValidStellarAddress, formatTokenBalance } from '../constants/tokens';
import type { TokenBalance } from './TokenBalanceCard';

interface TokenSelectorProps {
  tokens: TokenBalance[];
  selectedToken: TokenInfo | null;
  onSelect: (token: TokenInfo) => void;
  onAddCustomToken?: (address: string) => Promise<TokenInfo | null>;
  showBalance?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const TokenSelector: React.FC<TokenSelectorProps> = ({
  tokens,
  selectedToken,
  onSelect,
  onAddCustomToken,
  showBalance = true,
  disabled = false,
  placeholder = 'Select token',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddToken, setShowAddToken] = useState(false);
  const [customTokenAddress, setCustomTokenAddress] = useState('');
  const [isAddingToken, setIsAddingToken] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowAddToken(false);
        setSearchQuery('');
        setCustomTokenAddress('');
        setAddError(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Filter tokens based on search query
  const filteredTokens = useMemo(() => {
    if (!searchQuery) return tokens;
    const query = searchQuery.toLowerCase();
    return tokens.filter(
      (tb) =>
        tb.token.symbol.toLowerCase().includes(query) ||
        tb.token.name.toLowerCase().includes(query) ||
        tb.token.address.toLowerCase().includes(query)
    );
  }, [tokens, searchQuery]);

  const selectedTokenBalance = useMemo(() => {
    if (!selectedToken) return null;
    return tokens.find((tb) => tb.token.address === selectedToken.address);
  }, [tokens, selectedToken]);

  const handleSelect = (token: TokenInfo) => {
    onSelect(token);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleAddCustomToken = async () => {
    if (!onAddCustomToken || !customTokenAddress.trim()) return;

    // Validate address
    if (!isValidStellarAddress(customTokenAddress.trim())) {
      setAddError('Invalid Stellar token address');
      return;
    }

    // Check if already exists
    if (tokens.some((t) => t.token.address === customTokenAddress.trim())) {
      setAddError('Token already in list');
      return;
    }

    setIsAddingToken(true);
    setAddError(null);

    try {
      const newToken = await onAddCustomToken(customTokenAddress.trim());
      if (newToken) {
        onSelect(newToken);
        setShowAddToken(false);
        setCustomTokenAddress('');
        setIsOpen(false);
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Failed to add token');
    } finally {
      setIsAddingToken(false);
    }
  };

  const selectedIcon = selectedToken?.icon || (selectedToken ? getTokenIcon(selectedToken.symbol) : '🪙');

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3
          rounded-lg border transition-all
          ${disabled
            ? 'bg-gray-800/50 border-gray-700 cursor-not-allowed opacity-50'
            : isOpen
              ? 'bg-gray-800 border-purple-500 ring-1 ring-purple-500'
              : 'bg-gray-800/50 border-gray-600 hover:border-purple-500/50'
          }
        `}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {selectedToken ? (
            <>
              <span className="text-lg sm:text-xl flex-shrink-0">{selectedIcon}</span>
              <div className="min-w-0">
                <span className="font-semibold text-white">{selectedToken.symbol}</span>
                {showBalance && selectedTokenBalance && (
                  <span className="text-xs sm:text-sm text-gray-400 ml-2">
                    {formatTokenBalance(selectedTokenBalance.balance, selectedToken.decimals)}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          size={18}
          className={`text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
          {/* Search Input */}
          <div className="p-2 sm:p-3 border-b border-gray-700">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or address..."
                className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Token List or Add Token Form */}
          {!showAddToken ? (
            <>
              {/* Token List */}
              <div className="max-h-[200px] sm:max-h-[250px] overflow-y-auto">
                {filteredTokens.length > 0 ? (
                  filteredTokens.map((tokenBalance) => {
                    const { token, balance, isLoading } = tokenBalance;
                    const icon = token.icon || getTokenIcon(token.symbol);
                    const isSelected = selectedToken?.address === token.address;

                    return (
                      <button
                        key={token.address}
                        type="button"
                        onClick={() => handleSelect(token)}
                        className={`
                          w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3
                          transition-colors text-left
                          ${isSelected
                            ? 'bg-purple-600/20'
                            : 'hover:bg-gray-800'
                          }
                        `}
                      >
                        <span className="text-lg sm:text-xl flex-shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{token.symbol}</span>
                            {token.isNative && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-300">
                                Native
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate">{token.name}</p>
                        </div>
                        {showBalance && (
                          <div className="text-right flex-shrink-0">
                            {isLoading ? (
                              <Loader2 size={14} className="animate-spin text-gray-400" />
                            ) : (
                              <span className="text-sm text-gray-300">
                                {formatTokenBalance(balance, token.decimals)}
                              </span>
                            )}
                          </div>
                        )}
                        {isSelected && (
                          <Check size={16} className="text-purple-400 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-4 py-6 text-center text-gray-400">
                    <p className="text-sm">No tokens found</p>
                    <p className="text-xs mt-1">Try a different search or add a custom token</p>
                  </div>
                )}
              </div>

              {/* Add Custom Token Button */}
              {onAddCustomToken && (
                <div className="p-2 border-t border-gray-700">
                  <button
                    type="button"
                    onClick={() => setShowAddToken(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-purple-300 transition-colors"
                  >
                    <Plus size={16} />
                    <span className="text-sm font-medium">Add Custom Token</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Add Custom Token Form */
            <div className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-white">Add Custom Token</h4>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddToken(false);
                    setCustomTokenAddress('');
                    setAddError(null);
                  }}
                  className="p-1 hover:bg-gray-700 rounded text-gray-400"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Token Contract Address</label>
                  <input
                    type="text"
                    value={customTokenAddress}
                    onChange={(e) => {
                      setCustomTokenAddress(e.target.value);
                      setAddError(null);
                    }}
                    placeholder="C... (56 characters)"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>

                {addError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle size={14} />
                    <span>{addError}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAddCustomToken}
                  disabled={isAddingToken || !customTokenAddress.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAddingToken ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={16} />
                      <span>Add Token</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TokenSelector;
