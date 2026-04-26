import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App';
import './index.css';
import './i18n';
import i18n from './i18n';
import { ToastProvider } from './context/ToastContext';
import { WalletProvider } from './context/WalletContext';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';
import { OnboardingProvider } from './context/OnboardingProvider';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { AppErrorBoundary } from './components/ErrorHandler';
import { flushOfflineErrorQueue } from './components/ErrorReporting';
import { RealtimeNotificationBridge } from './components/RealtimeNotificationBridge';
import { registerServiceWorker } from './utils/pwa';

registerServiceWorker();

function AppWithErrorBoundary() {
  useEffect(() => {
    const onOnline = () => {
      flushOfflineErrorQueue().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

function RootApp() {
  return (
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ToastProvider>
            <WalletProvider>
              <RealtimeProvider>
                <NotificationProvider>
                  <OnboardingProvider>
                    <RealtimeNotificationBridge />
                    <AppWithErrorBoundary />
                  </OnboardingProvider>
                </NotificationProvider>
              </RealtimeProvider>
            </WalletProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nextProvider>
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<RootApp />);
