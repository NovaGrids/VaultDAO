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
}

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined,
);