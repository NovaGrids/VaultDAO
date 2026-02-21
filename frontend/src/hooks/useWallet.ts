import { useContext } from "react";
import { WalletContext } from "../context/WalletContextProps";

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};