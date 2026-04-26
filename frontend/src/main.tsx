import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App';
import './index.css';
import './i18n';
import i18n from './i18n';
import { ToastProvider } from './context/ToastContext';
import { WalletProviders } from './components/WalletProviders';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';
import { OnboardingProvider } from './context/OnboardingProvider';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { AppErrorBoundary } from './components/ErrorHandler';
import { flushOfflineErrorQueue } from './components/ErrorReporting';
import { registerServiceWorker } from './utils/pwa';
import { AccessibilityProvider } from './contexts/AccessibilityContext';
import { SkipLinks } from './components/SkipLinks';

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
        <AccessibilityProvider>
          <ThemeProvider>
            <ToastProvider>
              <WalletProviders>
                <NotificationProvider>
                  <OnboardingProvider>
                    <RealtimeProvider>
                      <SkipLinks />
                      {/* aria-live region for screen reader announcements */}
                      <div
                        id="sr-announcer"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        className="sr-only"
                      />
                      <AppWithErrorBoundary />
                    </RealtimeProvider>
                  </OnboardingProvider>
                </NotificationProvider>
              </WalletProviders>
            </ToastProvider>
          </ThemeProvider>
        </AccessibilityProvider>
      </I18nextProvider>
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<RootApp />);
