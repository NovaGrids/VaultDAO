/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getUserInfo, isAllowed, setAllowed } from '@stellar/freighter-api';

interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const checkConnection = async () => {
    if (await isAllowed()) {
      const userInfo = await getUserInfo();
      if (userInfo?.publicKey) {
        setIsConnected(true);
        setAddress(userInfo.publicKey);
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (await isAllowed()) {
        const userInfo = await getUserInfo();
        if (mounted && userInfo?.publicKey) {
          setIsConnected(true);
          setAddress(userInfo.publicKey);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const connect = async () => {
    try {
      await setAllowed();
      await checkConnection();
    } catch (error) {
      console.error('Failed to connect wallet', error);
    }
  };

  const disconnect = async () => {
    setIsConnected(false);
    setAddress(null);
  };

  return (
    <WalletContext.Provider value={{ isConnected, address, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
