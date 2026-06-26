/**
 * Wallet switcher component - mobile responsive selector for multiple wallets.
 * Includes idle session timeout countdown warning and re-auth flow.
 */

import { useState } from 'react';
import { ChevronDown, Wallet, ExternalLink, Clock, BookmarkCheck } from 'lucide-react';
import type { WalletAdapter } from '../adapters';

interface WalletSwitcherProps {
  availableWallets: WalletAdapter[];
  selectedWalletId: string | null;
  onSelect: (adapter: WalletAdapter) => void;
  disabled?: boolean;
  className?: string;
  /** Seconds remaining before auto-disconnect (null = no countdown active). */
  idleCountdown?: number | null;
  /** Whether the idle warning banner is visible. */
  isIdleWarning?: boolean;
  /** Dismiss the warning and reset the idle timer. */
  onDismissIdle?: () => void;
  /** "Remember me for 24h" handler. */
  onRememberSession?: () => void;
  /** Whether a remember-me session is already active. */
  isSessionPersisted?: boolean;
  /** Called to trigger re-authentication after auto-disconnect. */
  onReconnect?: () => void;
  /** True when the wallet has been auto-disconnected (shows re-auth prompt). */
  isAutoDisconnected?: boolean;
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
  idleCountdown = null,
  isIdleWarning = false,
  onDismissIdle,
  onRememberSession,
  isSessionPersisted = false,
  onReconnect,
  isAutoDisconnected = false,
}: WalletSwitcherProps) {
  const [open, setOpen] = useState(false);
  const selected = availableWallets.find((a) => a.id === selectedWalletId);

  return (
    <div className={`relative ${className}`}>
      {/* Idle countdown warning banner */}
      {isIdleWarning && idleCountdown !== null && idleCountdown > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-yellow-600 bg-yellow-900/40 px-3 py-2 text-sm text-yellow-300"
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              You will be disconnected in <strong>{idleCountdown}s</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={onDismissIdle}
            className="rounded bg-yellow-700/60 px-2 py-0.5 text-xs font-medium hover:bg-yellow-700 transition-colors"
          >
            Stay connected
          </button>
        </div>
      )}

      {/* Re-authentication prompt shown after auto-disconnect */}
      {isAutoDisconnected && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-2 flex flex-col gap-2 rounded-lg border border-red-700 bg-red-900/30 px-3 py-3 text-sm text-red-300"
        >
          <span>Session expired due to inactivity.</span>
          <button
            type="button"
            onClick={onReconnect}
            className="self-start rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors"
          >
            Reconnect wallet
          </button>
        </div>
      )}

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
          {isSessionPersisted && (
            <BookmarkCheck className="h-3.5 w-3.5 text-green-400" title="Session persisted (24 h)" />
          )}
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

            {/* Session persistence option */}
            {!isSessionPersisted && onRememberSession && (
              <div className="mt-1 border-t border-gray-700 px-4 py-2">
                <button
                  type="button"
                  onClick={() => {
                    onRememberSession();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 text-left text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <BookmarkCheck className="h-3.5 w-3.5 shrink-0" />
                  Remember me for 24 h
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default WalletSwitcher;
