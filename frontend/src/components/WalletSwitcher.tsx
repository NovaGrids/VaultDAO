/**
 * Wallet switcher component - mobile responsive selector for multiple wallets.
 */

import { useState } from 'react';
import { ChevronDown, Wallet, ExternalLink } from 'lucide-react';
import type { WalletAdapter } from '../adapters';

interface WalletSwitcherProps {
  availableWallets: WalletAdapter[];
  selectedWalletId: string | null;
  onSelect: (adapter: WalletAdapter) => void;
  disabled?: boolean;
  className?: string;
}

const WALLET_LABELS: Record<string, string> = {
  freighter: 'Freighter',
  albedo: 'Albedo',
  rabet: 'Rabet',
};

export function WalletSwitcher({
  availableWallets,
  selectedWalletId,
  onSelect,
  disabled = false,
  className = '',
}: WalletSwitcherProps) {
  const [open, setOpen] = useState(false);
  const selected = availableWallets.find((a) => a.id === selectedWalletId);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2.5 text-left text-sm text-white hover:bg-gray-700 disabled:opacity-50 sm:w-auto"
      >
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 shrink-0 text-purple-400" aria-hidden />
          <span>
            {selected ? WALLET_LABELS[selected.id] ?? selected.name : 'Select wallet'}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] rounded-lg border border-gray-600 bg-gray-800 py-2 shadow-xl sm:min-w-[240px]">
            {availableWallets.length === 0 ? (
              <p className="px-4 py-2 text-sm text-gray-400">No wallets detected</p>
            ) : (
              <ul className="space-y-0.5">
                {availableWallets.map((adapter) => (
                  <li key={adapter.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(adapter);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-700 ${
                        selectedWalletId === adapter.id ? 'bg-purple-600/20 text-purple-300' : 'text-white'
                      }`}
                    >
                      <span>{WALLET_LABELS[adapter.id] ?? adapter.name}</span>
                      <a
                        href={adapter.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded p-1 text-gray-400 hover:text-white"
                        aria-label={`Learn more about ${adapter.name}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default WalletSwitcher;
