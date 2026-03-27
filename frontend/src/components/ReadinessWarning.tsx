import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useActionReadiness } from '../hooks/useActionReadiness';

/**
 * Renders a warning banner when the wallet/network/contract is not ready for mutations.
 * Returns null when everything is ready.
 */
const ReadinessWarning: React.FC = () => {
  const { isReady, readinessMessage } = useActionReadiness();

  if (isReady || !readinessMessage) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300 mb-4">
      <AlertTriangle size={16} className="shrink-0" />
      <span>{readinessMessage}</span>
    </div>
  );
};

export default ReadinessWarning;
