/**
 * Wallet switcher — shows wallet types AND available accounts with role badges.
 * Keyboard-navigable dropdown with ARIA roles.
 */

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Wallet, ExternalLink, Check } from 'lucide-react';
import type { WalletAdapter } from '../adapters';

interface WalletSwitcherProps {
  availableWallets: WalletAdapter[];
  selectedWalletId: string | null;
  onSelect: (adapter: WalletAdapter) => void;
  /** Currently connected address */
  address?: string | null;
  /** All accounts available in the connected wallet */
  availableAccounts?: string[];
  /** Switch to a different account */
  onSwitchAccount?: (account: string) => void;
  /** Role of the current account */
  accountRole?: string | null;
  disabled?: boolean;
  className?: string;
}

const WALLET_LABELS: Record<string, string> = {
  freighter: 'Freighter',
  albedo: 'Albedo',
  rabet: 'Rabet',
};

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-red-500/20 text-red-400',
  Treasurer: 'bg-purple-500/20 text-purple-400',
  Member: 'bg-blue-500/20 text-blue-400',
};

function truncate(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function WalletSwitcher({
  availableWallets,
  selectedWalletId,
  onSelect,
  address,
  availableAccounts = [],
  onSwitchAccount,
  accountRole,
  disabled = false,
  className = '',
}: WalletSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = availableWallets.find((a) => a.id === selectedWalletId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keyboard navigation
  const totalItems = availableWallets.length + availableAccounts.length;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setFocusedIdx(0);
      }
      return;
    }
    if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx((i) => (i + 1) % totalItems); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedIdx((i) => (i - 1 + totalItems) % totalItems); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const walletCount = availableWallets.length;
      if (focusedIdx < walletCount) {
        onSelect(availableWallets[focusedIdx]);
      } else {
        const acct = availableAccounts[focusedIdx - walletCount];
        if (acct && onSwitchAccount) onSwitchAccount(acct);
      }
      setOpen(false);
    }
  };

  const label = selected ? (WALLET_LABELS[selected.id] ?? selected.name) : 'Select wallet';
  const displayAddr = address ? truncate(address) : null;

  return (
    <div className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen(!open); setFocusedIdx(0); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Wallet: ${label}${displayAddr ? `, account ${displayAddr}` : ''}`}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2.5 text-left text-sm text-white hover:bg-gray-700 disabled:opacity-50 sm:w-auto"
      >
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 shrink-0 text-purple-400" aria-hidden />
          <span>{label}</span>
          {displayAddr && <span className="font-mono text-xs text-gray-400">{displayAddr}</span>}
          {accountRole && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ROLE_COLORS[accountRole] ?? 'bg-gray-500/20 text-gray-400'}`}>
              {accountRole}
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Select wallet or account"
          className="absolute left-0 top-full z-20 mt-1 min-w-[240px] rounded-lg border border-gray-600 bg-gray-800 py-2 shadow-xl"
        >
          {/* Wallet type section */}
          {availableWallets.length > 0 && (
            <>
              <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Wallets</p>
              <ul>
                {availableWallets.map((adapter, idx) => (
                  <li key={adapter.id} role="option" aria-selected={selectedWalletId === adapter.id}>
                    <button
                      type="button"
                      onClick={() => { onSelect(adapter); setOpen(false); }}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-700 focus:bg-gray-700 outline-none ${
                        focusedIdx === idx ? 'bg-gray-700' : ''
                      } ${selectedWalletId === adapter.id ? 'text-purple-300' : 'text-white'}`}
                    >
                      <span>{WALLET_LABELS[adapter.id] ?? adapter.name}</span>
                      <div className="flex items-center gap-1">
                        {selectedWalletId === adapter.id && <Check className="h-3.5 w-3.5 text-purple-400" />}
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
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Accounts section */}
          {availableAccounts.length > 0 && onSwitchAccount && (
            <>
              <div className="my-1 border-t border-gray-700" />
              <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Accounts</p>
              <ul>
                {availableAccounts.map((acct, idx) => {
                  const globalIdx = availableWallets.length + idx;
                  const isActive = acct === address;
                  return (
                    <li key={acct} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        onClick={() => { onSwitchAccount(acct); setOpen(false); }}
                        className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-700 focus:bg-gray-700 outline-none ${
                          focusedIdx === globalIdx ? 'bg-gray-700' : ''
                        } ${isActive ? 'text-purple-300' : 'text-white'}`}
                      >
                        <span className="font-mono text-xs">{truncate(acct)}</span>
                        <div className="flex items-center gap-1.5">
                          {accountRole && isActive && (
                            <span className={`rounded px-1.5 py-0.5 text-xs ${ROLE_COLORS[accountRole] ?? 'bg-gray-500/20 text-gray-400'}`}>
                              {accountRole}
                            </span>
                          )}
                          {isActive && <Check className="h-3.5 w-3.5 text-purple-400" />}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {availableWallets.length === 0 && (
            <p className="px-4 py-2 text-sm text-gray-400">No wallets detected</p>
          )}
        </div>
      )}
    </div>
  );
}

export default WalletSwitcher;
