import React from 'react';
import { useRealtime } from '../contexts/RealtimeContext';
import type { ConnectionPhase } from '../hooks/useWebSocketReconnect';

interface StatusDotProps {
  phase: ConnectionPhase;
  attempt: number;
  onReconnect: () => void;
}

function StatusDot({ phase, attempt, onReconnect }: StatusDotProps) {
  if (phase === 'connected') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-400" title="Connected">
        <span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
        Connected
      </span>
    );
  }

  if (phase === 'reconnecting' || phase === 'connecting') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-400" title={`Reconnecting (attempt ${attempt})`}>
        <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
        Reconnecting…
        {attempt > 0 && <span className="opacity-70">({attempt}/{10})</span>}
      </span>
    );
  }

  if (phase === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-400">
        <span className="h-2 w-2 rounded-full bg-red-400" />
        Connection failed
        <button
          onClick={onReconnect}
          className="ml-1 underline hover:no-underline text-red-300 hover:text-white transition-colors"
        >
          Retry
        </button>
      </span>
    );
  }

  // disconnected / idle
  return (
    <span className="flex items-center gap-1.5 text-xs text-red-400" title="Disconnected">
      <span className="h-2 w-2 rounded-full bg-red-400" />
      Disconnected
    </span>
  );
}

interface RealtimeNotificationBridgeProps {
  /** When true, renders only the status dot (no wrapper styling). */
  compact?: boolean;
}

const RealtimeNotificationBridge: React.FC<RealtimeNotificationBridgeProps> = ({ compact = false }) => {
  const { connectionPhase, reconnectAttempt, reconnect } = useRealtime();

  const dot = (
    <StatusDot phase={connectionPhase} attempt={reconnectAttempt} onReconnect={reconnect} />
  );

  if (compact) return dot;

  return (
    <div className="flex items-center px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700">
      {dot}
    </div>
  );
};

export default RealtimeNotificationBridge;
