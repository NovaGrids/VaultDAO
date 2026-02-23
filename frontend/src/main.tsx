import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastProvider } from './context/ToastContext'
import { WalletProvider } from './context/WalletContext'
import { AccessibilityProvider } from './context/AccessibilityContext'
import { WebSocketProvider } from './context/WebSocketProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AccessibilityProvider>
      <ToastProvider>
        <WalletProvider>
          <WebSocketProvider>
            <App />
          </WebSocketProvider>
        </WalletProvider>
      </ToastProvider>
    </AccessibilityProvider>
  </React.StrictMode>,
)
)
