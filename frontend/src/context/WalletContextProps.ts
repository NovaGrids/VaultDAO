import { createContext } from "react";
import type { WalletAdapter } from "../adapters";

export type WalletType = 'freighter' | 'albedo' | 'rabet';

export interface WalletContextType {
  isConnected: boolean;
  isInstalled: boolean;
  address: string | null;
  network: string | null;
  walletType: WalletType | null;
  connect: (walletType?: WalletType) => Promise<void>;
  disconnect: () => Promise<void>;
  availableWallets: WalletAdapter[];
  selectedWalletId: string | null;
  setSelectedWallet: (id: WalletType) => void;
  switchWallet: (adapter: WalletAdapter) => void;
  signTransaction: (xdr: string, options?: { network?: string }) => Promise<string>;
  detectWallets: () => Promise<WalletAdapter[]>;
  /** All accounts available in the connected wallet */
  availableAccounts: string[];
  /** Switch to a different account within the same wallet */
  switchAccount: (account: string) => Promise<void>;
  /** Role of the current account in the vault */
  accountRole: string | null;
}

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined,
);