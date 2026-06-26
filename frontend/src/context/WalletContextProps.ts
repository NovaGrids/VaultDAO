import { createContext } from "react";
import type { WalletAdapter } from "../adapters";

export interface WalletContextType {
  isConnected: boolean;
  isInstalled: boolean;
  address: string | null;
  network: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  availableWallets: WalletAdapter[];
  selectedWalletId: string | null;
  setSelectedWallet: (id: string) => void;
  switchWallet: (adapter: WalletAdapter) => void;
  signTransaction: (xdr: string, options?: { network?: string }) => Promise<string>;
  detectWallets: () => Promise<WalletAdapter[]>;

  // Session management
  /** Seconds remaining in the idle-disconnect countdown (null = not counting down). */
  idleCountdown: number | null;
  /** True while the "you will be disconnected" warning is visible. */
  isIdleWarning: boolean;
  /** Dismisses the countdown and resets the idle timer without disconnecting. */
  dismissIdleWarning: () => void;
  /** Persist session for 24 h ("remember me"). */
  rememberSession: () => void;
  /** Whether the current session is persisted (remember-me active). */
  isSessionPersisted: boolean;
}

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined,
);
