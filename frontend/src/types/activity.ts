/**
 * Activity feed types for vault events.
 */

export type VaultEventType =
  | 'proposal_created'
  | 'proposal_approved'
  | 'proposal_ready'
  | 'proposal_executed'
  | 'proposal_rejected'
  | 'signer_added'
  | 'signer_removed'
  | 'config_updated'
  | 'initialized'
  | 'role_assigned'
  | 'unknown';

export interface VaultActivity {
  id: string;
  type: VaultEventType;
  timestamp: string; // ISO
  ledger: string;
  actor: string; // address
  details: Record<string, unknown>;
  txHash?: string;
  eventId: string;
  pagingToken?: string;
  /** Emitting contract (defaults to configured vault id when omitted) */
  contractId?: string;
  /** Soroban event topics joined with \\0 for stable fingerprinting */
  topicFingerprint?: string;
  /** Digest of event value XDR from RPC (when present) */
  payloadDigest?: string;
  /** From getEvents when available */
  callSucceeded?: boolean;
}

export interface VaultEventsFilters {
  eventTypes?: VaultEventType[];
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  actorAddress?: string;
}

export interface GetVaultEventsResult {
  activities: VaultActivity[];
  latestLedger: string;
  cursor?: string;
  hasMore: boolean;
}
