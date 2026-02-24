import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastProvider } from './context/ToastContext'
import { WalletProvider } from './context/WalletContext'
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
  
  useEffect(() => {
    // Register service worker for PWA
    if (import.meta.env.PROD) {
      registerServiceWorker().catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    }
  }, [])
  
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <WalletProvider>
        <AppWithErrorBoundary />
      </WalletProvider>
    </ToastProvider>
  </React.StrictMode>,
)
