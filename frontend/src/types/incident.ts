/**
 * Types for the incident war-room view (Issue #2066).
 *
 * Amounts are kept as strings so stroop/i128 values do not lose precision in
 * the browser. They are only converted to numbers for the utilisation meter.
 */

export type IncidentStatus = 'NORMAL' | 'TRIPPED' | 'PAUSED';

export type IncidentConnectionStatus = 'live' | 'reconnecting' | 'offline';

export interface IncidentPauseState {
  paused: boolean;
  cause?: string | null;
  pausedAt?: string | null;
  pausedBy?: string | null;
}

export interface TokenCircuitState {
  /** Human-readable token code, e.g. XLM. Rendered as text, never as HTML. */
  symbol: string;
  address?: string | null;
  /** Base-unit outflow observed in the current breaker window. */
  outflow: string;
  /** Base-unit circuit-breaker limit for this token. */
  limit: string;
  tripped?: boolean;
  windowLabel?: string;
  recoveryProposalId?: string | null;
}

export interface PendingReservation {
  proposalId: string;
  tokenSymbol: string;
  amount: string;
  createdAt?: string | null;
  recoveryProposalId?: string | null;
}

export interface IncidentSnapshot {
  pause: IncidentPauseState;
  tokens: TokenCircuitState[];
  reservations: PendingReservation[];
  updatedAt?: string | null;
  incidentId?: string | null;
  recoveryProposalId?: string | null;
}

export interface IncidentAcknowledgement {
  incidentId: string;
  status: IncidentStatus;
  tokenSymbols: string[];
  acknowledgedAt: string;
  actor?: string | null;
}

/**
 * The slice of RealtimeContext the war room needs. Kept structural so the
 * component can be tested with a lightweight stub (or with no context at all).
 */
export interface IncidentRealtimeLike {
  isConnected?: boolean;
  connectionStatus?: string | null;
  subscribe: <T = Record<string, unknown>>(type: string, handler: (data: T) => void) => () => void;
  sendUpdate?: (type: string, data: Record<string, unknown>) => void;
}

export const EMPTY_INCIDENT_SNAPSHOT: IncidentSnapshot = {
  pause: { paused: false },
  tokens: [],
  reservations: [],
  updatedAt: null,
  incidentId: null,
  recoveryProposalId: null,
};
