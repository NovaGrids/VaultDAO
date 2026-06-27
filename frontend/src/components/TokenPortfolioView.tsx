import React, { useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useTokenPrices } from '../hooks/useTokenPrices';
import { formatTokenBalance, getTokenIcon } from '../constants/tokens';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export interface TokenBalance {
  token: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    icon?: string;
    isNative: boolean;
    logoUrl?: string;
  };
  balance: string | number;
  isLoading?: boolean;
}

interface TokenPortfolioViewProps {
  tokenBalances: TokenBalance[];
  onRefresh?: () => void;
  isLoadingBalances?: boolean;
}

const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];

export function TokenPortfolioView({
  tokenBalances = [],
  onRefresh,
  isLoadingBalances = false,
}: TokenPortfolioViewProps) {
  const tokens = useMemo(() => tokenBalances.map((tb) => tb.token), [tokenBalances]);
  const { prices, loading: isLoadingPrices, lastUpdated, refresh } = useTokenPrices(tokens);

  const handleRefresh = () => {
    refresh();
    onRefresh?.();
  };

  // Calculate USD values, 24h changes and allocation percentages
  const portfolioItems = useMemo(() => {
    let totalUsd = 0;

    const items = tokenBalances.map((tb) => {
      const balanceNum = typeof tb.balance === 'string' ? parseFloat(tb.balance) : Number(tb.balance);
      const priceInfo = prices[tb.token.address];

      const usdPrice = priceInfo?.usd ?? null;
      const usdValue = usdPrice !== null ? balanceNum * usdPrice : null;
      const change24h = priceInfo?.change24h ?? null;

      if (usdValue !== null) {
        totalUsd += usdValue;
      }

      return {
        ...tb,
        balanceNum,
        usdPrice,
        usdValue,
        change24h,
      };
    });

    return items.map((item) => {
      const allocation = totalUsd > 0 && item.usdValue !== null
        ? (item.usdValue / totalUsd) * 100
        : 0;
      return {
        ...item,
        allocation,
      };
    });
  }, [tokenBalances, prices]);

  const totalPortfolioUsd = useMemo(() => {
    let sum = 0;
    let hasValidValue = false;
    portfolioItems.forEach((item) => {
      if (item.usdValue !== null) {
        sum += item.usdValue;
        hasValidValue = true;
      }
    });
    return hasValidValue ? sum : null;
  }, [portfolioItems]);

  const chartData = useMemo(() => {
    return portfolioItems
      .filter((item) => item.usdValue !== null && item.usdValue > 0)
      .map((item) => ({
        name: item.token.symbol,
        value: item.usdValue || 0,
      }));
  }, [portfolioItems]);

  const formatUsd = (val: number | null): string => {
    if (val === null) return 'N/A';
    return `$${val.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatPercent = (val: number | null): string => {
    if (val === null) return 'N/A';
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
  };

  const isUpdating = isLoadingBalances || isLoadingPrices;

  if (tokenBalances.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center text-gray-500 shadow-xl">
        <Wallet className="mx-auto h-12 w-12 text-gray-700 mb-3" />
        <h3 className="text-lg font-semibold text-white mb-1">Portfolio View</h3>
        <p className="text-sm text-gray-400">No assets found in this vault portfolio.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6 text-white">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-800 pb-5">
        <div>
          <span className="text-xs text-gray-500 uppercase tracking-widest font-semibold">Total Portfolio Balance</span>
          <h2 className="text-3xl font-bold tracking-tight text-white mt-1">
            {formatUsd(totalPortfolioUsd)}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Updated: {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isUpdating}
            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-colors border border-gray-700 flex items-center justify-center disabled:opacity-55"
            aria-label="Refresh portfolio data"
          >
            <RefreshCw size={16} className={isUpdating ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
        {/* Donut Chart (2/5 layout) */}
        <div className="lg:col-span-2 flex justify-center items-center h-48 lg:h-56">
          {chartData.length === 0 ? (
            <div className="text-xs text-gray-500 italic">No USD valuation data available for chart</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                  formatter={(val: any) => [formatUsd(typeof val === 'number' ? val : null), 'Value']}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Detailed Table View (3/5 layout) */}
        <div className="lg:col-span-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="py-2">Asset</th>
                <th className="py-2 text-right">Balance</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Value (USD)</th>
                <th className="py-2 text-right">24h Change</th>
                <th className="py-2 text-right">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {portfolioItems.map((item, index) => {
                const icon = item.token.logoUrl ? (
                  <img
                    src={item.token.logoUrl}
                    alt={item.token.symbol}
                    className="w-5 h-5 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="text-sm">{item.token.icon || getTokenIcon(item.token.symbol)}</span>
                );

                const changeColor = item.change24h === null
                  ? 'text-gray-500'
                  : item.change24h >= 0
                  ? 'text-green-400'
                  : 'text-red-400';

                const ChangeIcon = item.change24h === null
                  ? null
                  : item.change24h >= 0
                  ? TrendingUp
                  : TrendingDown;

                return (
                  <tr key={item.token.address} className="border-b border-gray-800/40 hover:bg-gray-800/10">
                    <td className="py-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
                        {icon}
                      </div>
                      <div>
                        <p className="font-semibold">{item.token.symbol}</p>
                        <p className="text-[10px] text-gray-500 truncate max-w-[80px]">{item.token.name}</p>
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono">
                      {formatTokenBalance(item.balance, item.token.decimals)}
                    </td>
                    <td className="py-3 text-right font-mono text-gray-400">
                      {formatUsd(item.usdPrice)}
                    </td>
                    <td className="py-3 text-right font-semibold font-mono">
                      {formatUsd(item.usdValue)}
                    </td>
                    <td className={`py-3 text-right font-mono ${changeColor}`}>
                      <div className="flex items-center justify-end gap-1">
                        {ChangeIcon && <ChangeIcon size={12} />}
                        <span>{formatPercent(item.change24h)}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono">
                      <div className="flex items-center justify-end gap-1.5">
                        <span 
                          className="w-1.5 h-1.5 rounded-full shrink-0" 
                          style={{ backgroundColor: COLORS[index % COLORS.length] }} 
                        />
                        <span>{item.allocation.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
