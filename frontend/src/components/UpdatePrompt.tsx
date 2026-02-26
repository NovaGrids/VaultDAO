import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { setupUpdateListener, applyUpdate } from '../utils/pwa';

export function UpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const cleanup = setupUpdateListener(() => {
      setUpdateAvailable(true);
    });

    return cleanup;
  }, []);

  const handleUpdate = async () => {
    setUpdating(true);
    await applyUpdate();
  };

  if (!updateAvailable) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
      <div className="rounded-xl border border-blue-500/30 bg-gray-900/95 backdrop-blur-md p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 rounded-lg bg-blue-500/20 p-2">
            <RefreshCw className="h-5 w-5 text-blue-400" aria-hidden="true" />
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white mb-1">
              Update Available
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              A new version of VaultDAO is ready to install
            </p>
            
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
              aria-label={updating ? 'Updating app' : 'Update app now'}
            >
              {updating ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Updating...
                </span>
              ) : (
                'Update Now'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpdatePrompt;
