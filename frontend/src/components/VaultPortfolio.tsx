import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import TokenBalanceCard from './TokenBalanceCard';
import type { TokenBalance } from '../types';
import { formatCurrency } from '../utils/localeFormatter';

interface VaultPortfolioProps {
  tokenBalances: TokenBalance[];
  weeklySpendingLimit?: number;
  isLoading?: boolean;
  onRefresh?: () => void;
}

const REFRESH_INTERVAL_MS = 30_000;

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#ec4899'];

const VaultPortfolio: React.FC<VaultPortfolioProps> = ({
  tokenBalances,
  weeklySpendingLimit = 0,
  isLoading = false,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const refresh = useCallback(() => {
    onRefresh?.();
    setLastRefresh(Date.now());
  }, [onRefresh]);

  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const totalUsdValue = tokenBalances.reduce((sum, tb) => sum + (tb.usdValue ?? 0), 0);

  const allocations = tokenBalances
    .filter((tb) => (tb.usdValue ?? 0) > 0)
    .map((tb) => ({
      symbol: tb.token.symbol,
      value: tb.usdValue ?? 0,
      percentage: totalUsdValue > 0 ? ((tb.usdValue ?? 0) / totalUsdValue) * 100 : 0,
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {t('portfolio.title', 'Portfolio Overview')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('portfolio.totalValue', 'Total Value')}:{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatCurrency(totalUsdValue)}
            </span>
            <span className="text-xs ml-1 rtl:mr-1 rtl:ml-0 text-amber-500">
              ({t('portfolio.estimate', 'estimate')})
            </span>
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
          aria-label={t('common.refresh', 'Refresh')}
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {allocations.length > 0 && (
        <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {t('portfolio.allocation', 'Token Allocation')}
          </h3>
          <div className="flex rounded-full overflow-hidden h-4 bg-gray-100 dark:bg-gray-700">
            {allocations.map((alloc, i) => (
              <div
                key={alloc.symbol}
                style={{
                  width: `${alloc.percentage}%`,
                  backgroundColor: COLORS[i % COLORS.length],
                }}
                title={`${alloc.symbol}: ${alloc.percentage.toFixed(1)}%`}
                className="transition-all duration-300"
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {allocations.map((alloc, i) => (
              <div key={alloc.symbol} className="flex items-center gap-1.5 text-xs">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="text-gray-600 dark:text-gray-400">
                  {alloc.symbol} {alloc.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tokenBalances.map((tb) => {
          const isLowBalance =
            weeklySpendingLimit > 0 && (tb.usdValue ?? 0) < weeklySpendingLimit;

          return (
            <div key={tb.token.symbol} className="relative">
              {isLowBalance && (
                <div className="absolute -top-2 -right-2 rtl:-left-2 rtl:right-auto z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-medium border border-amber-200 dark:border-amber-700">
                  <AlertTriangle size={10} />
                  {t('portfolio.lowBalance', 'Low Balance')}
                </div>
              )}
              <TokenBalanceCard tokenBalance={tb} showUsdValue />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VaultPortfolio;
