import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SorobanReactProvider, getDefaultConnectors } from '@soroban-react/core';
import type { WalletChain } from '@soroban-react/types';
import './index.css';
import { WalletProvider } from './context/WalletContext';

const network = import.meta.env.VITE_STELLAR_NETWORK ?? 'testnet';
const networkPassphrase =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
const networkUrl = import.meta.env.VITE_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const sorobanRpcUrl =
  import.meta.env.VITE_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';

const chain: WalletChain = {
  id: network,
  name: network,
  network,
  networkPassphrase,
  networkUrl,
  sorobanRpcUrl,
};

const chains: WalletChain[] = [chain];
const connectors = getDefaultConnectors();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <SorobanReactProvider chains={chains} activeChain={chain} connectors={connectors}>
        <App />
      </SorobanReactProvider>
    </WalletProvider>
  </React.StrictMode>,
);
