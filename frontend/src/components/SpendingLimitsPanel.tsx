import React, { useState, useMemo, useEffect } from 'react';
import { 
  Shield, 
  ArrowRight, 
  AlertTriangle, 
  Loader2, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown,
  Info
} from 'lucide-react';
import { useVaultContract, type VaultConfig } from '../hooks/useVaultContract';
import { decimalToStroops, stroopsToDecimal, formatAmount } from '../utils/amount';
import ConfirmationModal from './modals/ConfirmationModal';

interface SpendingLimitsPanelProps {
  isAdmin: boolean;
}

const SpendingLimitsPanel: React.FC<SpendingLimitsPanelProps> = ({ isAdmin }) => {
  const { getVaultConfig, updateSpendingLimits, loading: contractLoading } = useVaultContract();
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  // Form state
  const [proposalLimit, setProposalLimit] = useState<string>('');
  const [dailyLimit, setDailyLimit] = useState<string>('');
  const [weeklyLimit, setWeeklyLimit] = useState<string>('');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const config = await getVaultConfig();
      setVaultConfig(config);
      setProposalLimit(stroopsToDecimal(config.spendingLimit).toString());
      setDailyLimit(stroopsToDecimal(config.dailyLimit).toString());
      setWeeklyLimit(stroopsToDecimal(config.weeklyLimit).toString());
    } catch (err) {
      setError('Failed to load vault configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const validation = useMemo(() => {
    const p = parseFloat(proposalLimit) || 0;
    const d = parseFloat(dailyLimit) || 0;
    const w = parseFloat(weeklyLimit) || 0;

    const errors: string[] = [];
    if (p <= 0 || d <= 0 || w <= 0) errors.push('All limits must be positive');
    if (p > d) errors.push('Proposal limit cannot exceed daily limit');
    if (d > w) errors.push('Daily limit cannot exceed weekly limit');

    return {
      isValid: errors.length === 0,
      errors
    };
  }, [proposalLimit, dailyLimit, weeklyLimit]);

  const previewChanges = useMemo(() => {
    if (!vaultConfig) return [];
    
    const currentP = stroopsToDecimal(vaultConfig.spendingLimit);
    const currentD = stroopsToDecimal(vaultConfig.dailyLimit);
    const currentW = stroopsToDecimal(vaultConfig.weeklyLimit);
    
    const newP = parseFloat(proposalLimit) || 0;
    const newD = parseFloat(dailyLimit) || 0;
    const newW = parseFloat(weeklyLimit) || 0;

    const changes = [
      { label: 'Per-proposal', current: currentP, next: newP },
      { label: 'Daily', current: currentD, next: newD },
      { label: 'Weekly', current: currentW, next: newW },
    ];

    return changes.map(c => {
      const diff = c.next - c.current;
      const percent = c.current > 0 ? (diff / c.current) * 100 : 0;
      return { ...c, diff, percent };
    });
  }, [vaultConfig, proposalLimit, dailyLimit, weeklyLimit]);

  const handleUpdate = async () => {
    if (!validation.isValid) return;
    setIsModalOpen(true);
  };

  const confirmUpdate = async () => {
    setIsModalOpen(false);
    setUpdating(true);
    setError(null);
    setSuccess(null);

    try {
      const pStroops = BigInt(decimalToStroops(proposalLimit));
      const dStroops = BigInt(decimalToStroops(dailyLimit));
      const wStroops = BigInt(decimalToStroops(weeklyLimit));

      await updateSpendingLimits(pStroops, dStroops, wStroops);
      setSuccess('Spending limits updated successfully');
      await fetchConfig();
    } catch (err: any) {
      setError(err.message || 'Failed to update spending limits');
    } finally {
      setUpdating(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
        <Shield className="mx-auto text-gray-500 mb-4" size={48} />
        <h3 className="text-xl font-bold text-white mb-2">Admin Access Required</h3>
        <p className="text-gray-400">You need administrator permissions to modify vault spending limits.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 flex flex-col items-center">
        <Loader2 className="animate-spin text-purple-500 mb-4" size={32} />
        <p className="text-gray-400">Loading limits configuration...</p>
      </div>
    );
  }

  const significantReduction = previewChanges.some(c => c.percent < -50);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-6 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="text-purple-400" size={24} />
          <div>
            <h3 className="text-lg font-semibold">Spending Limits Management</h3>
            <p className="text-sm text-gray-400">Adjust the vault's spending permissions</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* Alerts */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3 text-red-200">
            <AlertTriangle className="shrink-0 mt-0.5" size={18} />
            <p className="text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-start gap-3 text-green-200">
            <CheckCircle2 className="shrink-0 mt-0.5" size={18} />
            <p className="text-sm">{success}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Form */}
          <div className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Per-proposal Limit (XLM)</label>
                <input
                  type="number"
                  value={proposalLimit}
                  onChange={(e) => setProposalLimit(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Daily Limit (XLM)</label>
                <input
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Weekly Limit (XLM)</label>
                <input
                  type="number"
                  value={weeklyLimit}
                  onChange={(e) => setWeeklyLimit(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                  placeholder="0.00"
                />
              </div>
            </div>

            {validation.errors.length > 0 && (
              <ul className="space-y-1">
                {validation.errors.map((err, i) => (
                  <li key={i} className="text-sm text-red-400 flex items-center gap-2">
                    <div className="w-1 h-1 bg-red-400 rounded-full" />
                    {err}
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={handleUpdate}
              disabled={!validation.isValid || updating || contractLoading}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {updating ? <Loader2 className="animate-spin" size={20} /> : 'Update Limits'}
            </button>
          </div>

          {/* Impact Preview */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6 space-y-6">
            <h4 className="font-semibold text-gray-300 flex items-center gap-2">
              <Info size={18} className="text-blue-400" />
              Impact Preview
            </h4>
            
            <div className="space-y-4">
              {previewChanges.map((change, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">{change.label} Limit</span>
                    <span className={`flex items-center gap-1 ${change.percent > 0 ? 'text-green-400' : change.percent < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {change.percent > 0 ? <TrendingUp size={14} /> : change.percent < 0 ? <TrendingDown size={14} /> : null}
                      {change.percent === 0 ? 'No change' : `${change.percent > 0 ? '+' : ''}${change.percent.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-800 rounded h-10 px-3 flex items-center text-gray-400 text-xs font-mono">
                      {formatAmount(change.current)}
                    </div>
                    <ArrowRight size={16} className="text-gray-600" />
                    <div className={`flex-1 rounded h-10 px-3 flex items-center text-xs font-mono border ${change.diff !== 0 ? 'bg-purple-500/10 border-purple-500/30 text-purple-200' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                      {formatAmount(change.next)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {significantReduction && (
              <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 flex items-start gap-3 text-yellow-200 text-sm">
                <AlertTriangle className="shrink-0 mt-0.5" size={18} />
                <p>Warning: You are significantly reducing one or more limits. This may block pending or future operations.</p>
              </div>
            )}
            
            <p className="text-xs text-gray-500 italic">
              * Limits apply immediately upon transaction confirmation.
            </p>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={isModalOpen}
        title="Update Spending Limits"
        message="Are you sure you want to update the vault's spending limits? This will affect all future transactions and proposals."
        confirmText="Confirm Update"
        onConfirm={confirmUpdate}
        onCancel={() => setIsModalOpen(false)}
        isDestructive={significantReduction}
      />
    </div>
  );
};

export default SpendingLimitsPanel;
