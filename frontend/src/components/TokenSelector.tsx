import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Plus, Check, Loader2, AlertCircle } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { env } from '../config/env';
import { 
  TokenInfo, 
  getAllTrackedTokens, 
  isValidStellarAddress, 
  saveCustomTokens, 
  formatTokenBalance,
  getTokenIcon
} from '../constants/tokens';

interface TokenSelectorProps {
  value: string;
  onChange: (address: string) => void;
  showBalance?: boolean;
}

interface TokenWithBalance extends TokenInfo {
  balance?: string;
  loading?: boolean;
}

const TokenSelector: React.FC<TokenSelectorProps> = ({ value, onChange, showBalance = true }) => {
  const { address } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customAddress, setCustomAddress] = useState('');
  const [tokens, setTokens] = useState<TokenWithBalance[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = async () => {
    if (!address) return;
    const tracked = getAllTrackedTokens();
    setTokens(tracked.map(t => ({ ...t, loading: true })));

    try {
      const res = await fetch(`${env.horizonUrl}/accounts/${address}`);
      const data = await res.json();
      interface HorizonBalance { asset_type: string; balance: string; asset_code?: string; }
      const balances: HorizonBalance[] = data.balances || [];
      
      setTokens(prev => prev.map(t => {
        const b = t.isNative 
          ? balances.find(b => b.asset_type === 'native')
          : balances.find(b => b.asset_code === t.symbol);
        return { ...t, balance: b?.balance || '0', loading: false };
      }));
    } catch (err) {
      setTokens(prev => prev.map(t => ({ ...t, loading: false })));
    }
  };

  useEffect(() => { if (isOpen) fetchBalances(); }, [isOpen, address]);

  const filtered = useMemo(() => tokens.filter(t => 
    t.symbol.toLowerCase().includes(search.toLowerCase()) || 
    t.address.toLowerCase().includes(search.toLowerCase())
  ), [tokens, search]);

  const selected = useMemo(() => tokens.find(t => t.address === value) || tokens[0], [tokens, value]);

  const handleAdd = () => {
    if (!isValidStellarAddress(customAddress)) return setError('Invalid address');
    if (tokens.some(t => t.address === customAddress)) return setError('Token already exists');
    
    const newToken: TokenInfo = { 
      address: customAddress, 
      symbol: 'CUSTOM', 
      name: 'Custom Token', 
      decimals: 7, 
      isNative: false 
    };
    
    const currentCustom = getAllTrackedTokens().filter(t => !t.isNative);
    saveCustomTokens([...currentCustom, newToken]);
    setCustomAddress('');
    setError(null);
    fetchBalances();
  };

  return (
    <div className="relative w-full">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded-lg text-white hover:border-purple-500 transition-all">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-xl">{selected?.icon || getTokenIcon(selected?.symbol || '')}</span>
          <div className="flex flex-col items-start min-w-0">
            <span className="font-bold">{selected?.symbol || 'Select Token'}</span>
            <span className="text-xs text-gray-400 truncate w-full">
              {selected?.address === 'NATIVE' ? 'Native XLM' : `${selected?.address.slice(0, 6)}...${selected?.address.slice(-6)}`}
            </span>
          </div>
        </div>
        <ChevronDown className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} size={20} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-fadeIn">
          <div className="p-3 border-b border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tokens..." className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto">
            {filtered.map(t => (
              <button key={t.address} onClick={() => { onChange(t.address); setIsOpen(false); }} className={`w-full flex items-center justify-between p-3 hover:bg-gray-800 transition-colors ${value === t.address ? 'bg-purple-600/20' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="text-xl">{t.icon || getTokenIcon(t.symbol)}</span>
                  <div className="text-left">
                    <div className="font-medium text-white">{t.symbol}</div>
                    <div className="text-xs text-gray-500">{t.name}</div>
                  </div>
                </div>
                {showBalance && (
                  <div className="text-right">
                    {t.loading ? <Loader2 className="animate-spin text-gray-600" size={14} /> : <div className="text-sm font-semibold text-gray-300">{formatTokenBalance(t.balance || '0')}</div>}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="p-3 border-t border-gray-800 bg-gray-900/50">
            <div className="flex gap-2">
              <input value={customAddress} onChange={e => { setCustomAddress(e.target.value); setError(null); }} placeholder="Paste SAC address..." className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500" />
              <button onClick={handleAdd} className="p-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white transition-colors"><Plus size={18} /></button>
            </div>
            {error && <div className="mt-2 flex items-center gap-1 text-red-400 text-[10px]"><AlertCircle size={10} /> {error}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default TokenSelector;
