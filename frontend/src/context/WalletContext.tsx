/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import {
  isConnected as freighterIsConnected,
  isAllowed,
  setAllowed,
  getUserInfo,
  getNetwork,
} from "@stellar/freighter-api";
import { useToast } from "./ToastContext";
import { WalletContext } from "./WalletContextProps";

export const WalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isInstalled, setIsInstalled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);

  const addressRef = useRef<string | null>(null);
  const networkRef = useRef<string | null>(null);

  const { showToast } = useToast();

  const checkInstallation = useCallback(async () => {
    try {
      const installed = await freighterIsConnected();
      setIsInstalled(!!installed);
      return !!installed;
    } catch (e) {
      console.error("Installation check failed", e);
      return false;
    }
  }, []);

  const validateNetwork = useCallback(async () => {
    try {
      const currentNetwork = await getNetwork();
      if (currentNetwork !== networkRef.current) {
        setNetwork(currentNetwork);
        networkRef.current = currentNetwork;

        if (currentNetwork && currentNetwork !== "TESTNET" && connected) {
          showToast("Please switch to Stellar Testnet in Freighter", "warning");
        }
      }
      return currentNetwork;
    } catch (e) {
      console.error("Failed to get network", e);
      return null;
    }
  }, [connected, showToast]);

  const updateWalletState = useCallback(async () => {
    try {
      const allowed = await isAllowed();
      if (allowed) {
        const userInfo = await getUserInfo();
        if (userInfo?.publicKey) {
          if (userInfo.publicKey !== addressRef.current) {
            setAddress(userInfo.publicKey);
            addressRef.current = userInfo.publicKey;
            setConnected(true);
          }
          await validateNetwork();
          return true;
        } else if (addressRef.current) {
          setAddress(null);
          addressRef.current = null;
          setConnected(false);
          localStorage.removeItem("wallet_connected");
        }
      } else if (addressRef.current) {
        setAddress(null);
        addressRef.current = null;
        setConnected(false);
        localStorage.removeItem("wallet_connected");
      }
    } catch (e) {
      console.error("Failed to update wallet state", e);
    }
    return false;
  }, [validateNetwork]);

  useEffect(() => {
    const init = async () => {
      const installed = await checkInstallation();
      if (installed) {
        const wasConnected =
          localStorage.getItem("wallet_connected") === "true";
        if (wasConnected) {
          await updateWalletState();
        }
      }
    };
    init();

    const interval = setInterval(async () => {
      if (await freighterIsConnected()) {
        await updateWalletState();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [checkInstallation, updateWalletState]);

  const connect = async () => {
    if (!isInstalled) {
      const installed = await checkInstallation();
      if (!installed) {
        showToast("Freighter wallet not found. Please install it.", "error");
        window.open("https://www.freighter.app/", "_blank");
        return;
      }
    }

    try {
      const allowed = await setAllowed();
      if (allowed) {
        const success = await updateWalletState();
        if (success) {
          localStorage.setItem("wallet_connected", "true");
          showToast("Wallet connected successfully!", "success");

          const net = await getNetwork();
          if (net !== "TESTNET") {
            showToast("Application works best on Testnet", "warning");
          }
        }
      } else {
        showToast("Connection request rejected", "error");
      }
    } catch (e: unknown) {
      console.error("Failed to connect wallet", e);
      const errorMessage =
        e instanceof Error ? e.message : "Failed to connect wallet";
      showToast(errorMessage, "error");
    }
  };

  const disconnect = async () => {
    setConnected(false);
    setAddress(null);
    setNetwork(null);
    addressRef.current = null;
    networkRef.current = null;
    localStorage.removeItem("wallet_connected");
    showToast("Wallet disconnected", "info");
  };

  return (
    <WalletContext.Provider
      value={{
        isConnected: connected,
        isInstalled,
        address,
        network,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export { useWallet } from '../hooks/useWallet';
