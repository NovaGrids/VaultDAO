import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, FileText, CheckCircle, Wallet, Loader2, Plus, TrendingUp, TrendingDown, X } from 'lucide-react';
import StatCard from '../../components/Layout/StatCard';
import TokenBalanceCard, { type TokenBalance } from '../../components/TokenBalanceCard';
import { useVaultContract } from '../../hooks/useVaultContract';
import { getAllTemplates, getMostUsedTemplates } from '../../utils/templates';
import type { TokenInfo } from '../../constants/tokens';
import { DEFAULT_TOKENS, isValidStellarAddress } from '../../constants/tokens';
import { formatTokenAmount } from '../../utils/formatters';

interface DashboardStats {
    totalBalance: string;
    totalProposals: number;
    pendingApprovals: number;
    readyToExecute: number;
    activeSigners: number;
    threshold: string;
}

interface PortfolioValue {
    total: number;
    change24h: number;
}

const Overview: React.FC = () => {
    const { getDashboardStats, getTokenBalances, getPortfolioValue, addCustomToken, loading } = useVaultContract();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
    const [portfolioValue, setPortfolioValue] = useState<PortfolioValue | null>(null);
    const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);
    const [showAddTokenModal, setShowAddTokenModal] = useState(false);
    const [newTokenAddress, setNewTokenAddress] = useState('');
    const [isAddingToken, setIsAddingToken] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [isLoadingBalances, setIsLoadingBalances] = useState(true);

    const quickActionTemplates = (() => {
        const mostUsed = getMostUsedTemplates(3);
        if (mostUsed.length > 0) {
            return mostUsed;
        }
        return getAllTemplates().slice(0, 3);
    })();

    const fetchBalance = async () => {
        setBalanceLoading(true);
        setBalanceError(null);
        try {
            const balanceInStroops = await getVaultBalance();
            setBalance(balanceInStroops);
            setLastUpdated(new Date());
        } catch (error) {
            console.error('Failed to fetch balance:', error);
            setBalanceError('Failed to load balance');
        } finally {
            setBalanceLoading(false);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            try {
                const result = await getDashboardStats();
                if (isMounted) {
                    setStats(result as DashboardStats);
                }
            } catch (error) {
                console.error('Failed to fetch dashboard data', error);
            }
        };
        fetchData();
        fetchBalance();
        return () => {
            isMounted = false;
        };
    }, [getDashboardStats]);

    // Fetch token balances
    const fetchTokenBalances = useCallback(async () => {
        setIsLoadingBalances(true);
        try {
            const balances = await getTokenBalances();
            const tokenBalancesWithLoading: TokenBalance[] = balances.map(b => ({
                ...b,
                isLoading: false,
            }));
            setTokenBalances(tokenBalancesWithLoading);

            // Fetch portfolio value
            const portfolio = await getPortfolioValue();
            setPortfolioValue(portfolio);
        } catch (error) {
            console.error('Failed to fetch token balances', error);
            // Set default tokens with zero balances on error
            setTokenBalances(DEFAULT_TOKENS.map(token => ({
                token,
                balance: '0',
                isLoading: false,
            })));
        } finally {
            setIsLoadingBalances(false);
        }
    }, [getTokenBalances, getPortfolioValue]);

    useEffect(() => {
        fetchTokenBalances();
    }, [fetchTokenBalances]);

    // Handle adding custom token
    const handleAddCustomToken = async () => {
        if (!newTokenAddress.trim()) {
            setAddError('Please enter a token address');
            return;
        }

        if (!isValidStellarAddress(newTokenAddress.trim())) {
            setAddError('Invalid Stellar token address');
            return;
        }

        setIsAddingToken(true);
        setAddError(null);

        try {
            const tokenInfo = await addCustomToken(newTokenAddress.trim());
            if (tokenInfo) {
                // Add to local state
                setTokenBalances(prev => [...prev, {
                    token: tokenInfo,
                    balance: '0',
                    isLoading: false,
                }]);
                setShowAddTokenModal(false);
                setNewTokenAddress('');
            }
        } catch (error) {
            setAddError(error instanceof Error ? error.message : 'Failed to add token');
        } finally {
            setIsAddingToken(false);
        }
    };

    // Handle token card click
    const handleTokenClick = (token: TokenInfo) => {
        setSelectedToken(selectedToken?.address === token.address ? null : token);
    };

    // Format portfolio value
    const formatPortfolioValue = (value: number): string => {
        if (value < 0.01) return '<$0.01';
        return `$${value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;
    };

    if (loading && !stats) {
        return (
            <div className="h-96 flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-10">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Treasury Overview</h2>
                <div className="text-sm text-gray-400 flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg border border-gray-700">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span>Network: Testnet</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="md:col-span-2 lg:col-span-1">
                    <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl border border-purple-500 p-6 h-full">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-white/10 rounded-lg">
                                    <Wallet className="h-6 w-6 text-white" />
                                </div>
                                <div>
                                    <p className="text-sm text-purple-200">Vault Balance</p>
                                    <p className="text-xs text-purple-300 mt-0.5">
                                        {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={fetchBalance}
                                disabled={balanceLoading}
                                className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                title="Refresh balance"
                            >
                                <RefreshCw className={`h-5 w-5 text-white ${balanceLoading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                        {balanceError ? (
                            <div className="text-center py-4">
                                <p className="text-red-300 text-sm mb-2">{balanceError}</p>
                                <button
                                    onClick={fetchBalance}
                                    className="text-xs text-white underline hover:no-underline"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <div className="text-3xl md:text-4xl font-bold text-white">
                                {balanceLoading ? (
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                ) : (
                                    formatTokenAmount(balance)
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <StatCard
                    title="Vault Balance"
                    value={`${stats?.totalBalance || '0'} XLM`}
                    icon={Wallet}
                    variant="primary"
                />
                <StatCard
                    title="Active Proposals"
                    value={stats?.totalProposals || 0}
                    subtitle={`${stats?.pendingApprovals || 0} pending vote`}
                    icon={FileText}
                    variant="warning"
                />
                <StatCard
                    title="Ready to Execute"
                    value={stats?.readyToExecute || 0}
                    subtitle="Passed timelock"
                    icon={CheckCircle}
                    variant="success"
                />
                <StatCard
                    title="Active Signers"
                    value={stats?.activeSigners || 0}
                    subtitle={`Threshold: ${stats?.threshold || '0/0'}`}
                    icon={LayoutDashboard}
                    variant="primary"
                />
            </div>

            {/* Token Balances Section */}
            <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Token Balances</h3>
                        {portfolioValue && (
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm text-gray-400">Total Value:</span>
                                <span className="text-lg font-bold text-white">{formatPortfolioValue(portfolioValue.total)}</span>
                                <span className={`text-xs flex items-center ${portfolioValue.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {portfolioValue.change24h >= 0 ? (
                                        <TrendingUp size={12} className="mr-1" />
                                    ) : (
                                        <TrendingDown size={12} className="mr-1" />
                                    )}
                                    {Math.abs(portfolioValue.change24h).toFixed(2)}%
                                </span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowAddTokenModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
                    >
                        <Plus size={16} />
                        <span>Add Token</span>
                    </button>
                </div>

                {/* Token Grid */}
                {isLoadingBalances ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                    </div>
                ) : tokenBalances.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {tokenBalances.map((tokenBalance) => (
                            <TokenBalanceCard
                                key={tokenBalance.token.address}
                                tokenBalance={tokenBalance}
                                onClick={() => handleTokenClick(tokenBalance.token)}
                                isSelected={selectedToken?.address === tokenBalance.token.address}
                                showUsdValue={true}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                        <Wallet size={48} className="mb-4 opacity-50" />
                        <p className="text-lg font-medium">No tokens found</p>
                        <p className="text-sm mt-1">Add a token to get started</p>
                    </div>
                )}
            </div>

            {/* Quick Actions Section */}
            <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 sm:p-6">
                <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">Quick Actions</h3>
                    <Link to="/dashboard/templates" className="text-sm text-purple-300 hover:text-purple-200">
                        Manage templates
                    </Link>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {quickActionTemplates.map((template) => (
                        <Link
                            key={template.id}
                            to={`/dashboard/proposals?template=${encodeURIComponent(template.id)}`}
                            className="min-h-[44px] rounded-lg border border-gray-600 bg-gray-900 p-3 text-left transition-colors hover:border-purple-500"
                        >
                            <p className="font-medium text-white">{template.name}</p>
                            <p className="text-sm text-gray-400">{template.category}</p>
                            <p className="text-xs text-gray-500">Used {template.usageCount} times</p>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Add Token Modal */}
            {showAddTokenModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-4 sm:p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-white">Add Custom Token</h3>
                            <button
                                onClick={() => {
                                    setShowAddTokenModal(false);
                                    setNewTokenAddress('');
                                    setAddError(null);
                                }}
                                className="p-1 hover:bg-gray-700 rounded text-gray-400"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">Token Contract Address</label>
                                <input
                                    type="text"
                                    value={newTokenAddress}
                                    onChange={(e) => {
                                        setNewTokenAddress(e.target.value);
                                        setAddError(null);
                                    }}
                                    placeholder="C... (56 characters)"
                                    className="w-full rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Enter the Stellar contract address for the token you want to track
                                </p>
                            </div>

                            {addError && (
                                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-lg">
                                    <span>{addError}</span>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setShowAddTokenModal(false);
                                        setNewTokenAddress('');
                                        setAddError(null);
                                    }}
                                    className="flex-1 min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddCustomToken}
                                    disabled={isAddingToken || !newTokenAddress.trim()}
                                    className="flex-1 min-h-[44px] rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isAddingToken ? 'Adding...' : 'Add Token'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Overview;
