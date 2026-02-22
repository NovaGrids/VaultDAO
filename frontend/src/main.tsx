import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastProvider } from './context/ToastContext'
import { WalletProvider } from './context/WalletContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ToastProvider>
  </React.StrictMode>,
)
