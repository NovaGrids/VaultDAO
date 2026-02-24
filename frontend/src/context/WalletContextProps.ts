import { createContext, useContext } from "react";
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
}

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined,
);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};