import React from 'react';
import { Wallet, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import type { TokenInfo } from '../constants/tokens';
import { formatTokenBalance, getTokenIcon } from '../constants/tokens';

export interface TokenBalance {
  token: TokenInfo;
  balance: string;
  usdValue?: number;
  change24h?: number;
  isLoading?: boolean;
}

interface TokenBalanceCardProps {
  tokenBalance: TokenBalance;
  onClick?: () => void;
  isSelected?: boolean;
  showUsdValue?: boolean;
  compact?: boolean;
}

const TokenBalanceCard: React.FC<TokenBalanceCardProps> = ({
  tokenBalance,
  onClick,
  isSelected = false,
  showUsdValue = true,
  compact = false,
}) => {
  const { token, balance, usdValue, change24h, isLoading } = tokenBalance;
  const icon = token.icon || getTokenIcon(token.symbol);

  const formatUsdValue = (value: number | undefined): string => {
    if (value === undefined) return '-';
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const getChangeColor = (change: number | undefined): string => {
    if (change === undefined) return 'text-gray-400';
    return change >= 0 ? 'text-green-400' : 'text-red-400';
  };

  const getChangeIcon = (change: number | undefined) => {
    if (change === undefined) return null;
    return change >= 0 ? (
      <TrendingUp size={12} className="inline-block mr-1" />
    ) : (
      <TrendingDown size={12} className="inline-block mr-1" />
    );
  };

  // Compact version for mobile/dropdown displays
  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`
          flex items-center gap-3 p-3 rounded-lg transition-all cursor-pointer
          ${isSelected
            ? 'bg-purple-600/20 border border-purple-500'
            : 'bg-gray-800/50 border border-gray-700 hover:border-purple-500/50'
          }
        `}
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-lg">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{token.symbol}</span>
            <span className="text-xs text-gray-400 truncate">{token.name}</span>
          </div>
          {isLoading ? (
            <Loader2 size={14} className="animate-spin text-gray-400 mt-1" />
          ) : (
            <span className="text-sm text-gray-300">
              {formatTokenBalance(balance, token.decimals)} {token.symbol}
            </span>
          )}
        </div>
        {isSelected && (
          <div className="w-2 h-2 rounded-full bg-purple-500" />
        )}
      </div>
    );
  }

  // Full card version
  return (
    <div
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-xl border p-4 sm:p-5 transition-all cursor-pointer
        ${isSelected
          ? 'bg-purple-600/10 border-purple-500 shadow-lg shadow-purple-500/10'
          : 'bg-gray-800/50 border-gray-700 hover:border-purple-500/50 hover:shadow-lg'
        }
        active:scale-[0.98]
      `}
    >
      {/* Background gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />

      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* Token Icon */}
          <div className={`
            flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-xl sm:text-2xl
            ${isSelected ? 'bg-purple-600/30' : 'bg-gray-700'}
          `}>
            {icon}
          </div>

          {/* Token Info */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-base sm:text-lg">{token.symbol}</h3>
              {token.isNative && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300">
                  Native
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-gray-400 truncate max-w-[120px] sm:max-w-[180px]">
              {token.name}
            </p>
          </div>
        </div>

        {/* Wallet Icon */}
        <div className="flex-shrink-0 p-2 rounded-lg bg-gray-700/50">
          <Wallet size={16} className="text-gray-400" />
        </div>
      </div>

      {/* Balance Section */}
      <div className="mt-4 space-y-1">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin text-purple-400" />
            <span className="text-sm text-gray-400">Loading balance...</span>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-xl sm:text-2xl font-bold text-white">
                {formatTokenBalance(balance, token.decimals)}
              </span>
              <span className="text-sm text-gray-400">{token.symbol}</span>
            </div>

            {/* USD Value */}
            {showUsdValue && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">
                  {formatUsdValue(usdValue)}
                </span>
                {change24h !== undefined && (
                  <span className={`text-xs flex items-center ${getChangeColor(change24h)}`}>
                    {getChangeIcon(change24h)}
                    {Math.abs(change24h).toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
      )}
    </div>
  );
};

export default TokenBalanceCard;
