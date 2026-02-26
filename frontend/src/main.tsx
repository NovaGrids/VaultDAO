import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastProvider } from './context/ToastContext'
import { WalletProvider } from './context/WalletContext'
 feature/notification-and-comparison-tools
import { NotificationProvider } from './context/NotificationContext'

import { ThemeProvider } from './context/ThemeContext' // New import

import { AppErrorBoundary } from './components/ErrorHandler'
import { flushOfflineErrorQueue } from './components/ErrorReporting'
import { registerServiceWorker } from './utils/pwa'

function AppWithErrorBoundary() {
  useEffect(() => {
    const onOnline = () => {
      flushOfflineErrorQueue().catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])
  
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  )
}

 feature/notification-and-comparison-tools
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <WalletProvider>
        <NotificationProvider>
          <AppWithErrorBoundary />
        </NotificationProvider>
      </WalletProvider>
    </ToastProvider>
  </React.StrictMode>,
)

export function RootApp() {
  return (
    <React.StrictMode>
      <ThemeProvider> {/* Wrapped here */}
        <ToastProvider>
          <WalletProvider>
            <AppWithErrorBoundary />
          </WalletProvider>
        </ToastProvider>
      </ThemeProvider>
    </React.StrictMode>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<RootApp />)

