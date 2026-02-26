import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './i18n' // Initialize i18n
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'
import { ToastProvider } from './context/ToastContext'
import { WalletProvider } from './context/WalletContext'
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

export function RootApp() {
  return (
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider> {/* Wrapped here */}
          <ToastProvider>
            <WalletProvider>
              <AppWithErrorBoundary />
            </WalletProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nextProvider>
    </React.StrictMode>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<RootApp />)
