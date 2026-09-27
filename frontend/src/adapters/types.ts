/**
 * Unified wallet adapter interface for multi-provider support.
 */

export interface WalletAdapter {
  id: string;
  name: string;
  icon?: string;
  url: string;
  isAvailable(): Promise<boolean>;
  connect(): Promise<{ publicKey: string; network?: string }>;
  disconnect(): Promise<void>;
  getPublicKey(): Promise<string | null>;
  getNetwork(): Promise<string | null>;
  signTransaction(xdr: string, options?: { network?: string }): Promise<string>;
  /**
   * Return all accounts accessible through this wallet.
   * Optional — wallets that expose only a single account at a time may omit
   * this. Callers should fall back to `[publicKey]` when it is absent.
   */
  getAccounts?(): Promise<string[]>;
}
