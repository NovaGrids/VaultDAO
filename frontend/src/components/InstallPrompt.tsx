import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { setupInstallPrompt, showInstallPrompt, isInstalled } from '../utils/pwa';

export function InstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isInstalled()) {
      return;
    }

    // Check if user previously dismissed
    const wasDismissed = localStorage.getItem('pwa-install-dismissed');
    if (wasDismissed) {
      setDismissed(true);
      return;
    }

    // Setup install prompt listener
    const cleanup = setupInstallPrompt((installable) => {
      setCanInstall(installable);
    });

    return cleanup;
  }, []);

  const handleInstall = async () => {
    const outcome = await showInstallPrompt();
    
    if (outcome === 'accepted') {
      setCanInstall(false);
    } else if (outcome === 'dismissed') {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!canInstall || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
      <div className="rounded-xl border border-purple-500/30 bg-gray-900/95 backdrop-blur-md p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 rounded-lg bg-purple-500/20 p-2">
            <Download className="h-5 w-5 text-purple-400" aria-hidden="true" />
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white mb-1">
              Install VaultDAO
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Install our app for faster access and offline support
            </p>
            
            <div className="flex gap-2">
              <button
                onClick={handleInstall}
                className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                aria-label="Install app"
              >
                Install
              </button>
              <button
                onClick={handleDismiss}
                className="rounded-lg bg-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                aria-label="Dismiss install prompt"
              >
                Not now
              </button>
            </div>
          </div>
          
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
            aria-label="Close install prompt"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default InstallPrompt;
