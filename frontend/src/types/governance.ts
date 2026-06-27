/**
 * Governance and signer reputation types for the VaultDAO frontend.
 */

export type SignerRole = 'Admin' | 'Treasurer' | 'Member';

export interface SignerActivity {
  id: string;
  type: string;
  proposalId?: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface SignerRecord {
  address: string;
  role: SignerRole;
  approvalsGiven: number;
  abstentions: number;
  proposalsCreated: number;
  participationRate: number; // 0–1
  reputationScore: number; // 0–1000
  lastActive: string; // ISO timestamp
  /** Last 10 vote outcomes: true = voted, false = missed */
  voteHistory: boolean[];
}

export type LeaderboardSortBy =
  | 'reputationScore'
  | 'approvalsGiven'
  | 'participationRate'
  | 'proposalsCreated'
  | 'lastActive';

export type SortOrder = 'asc' | 'desc';

export interface LeaderboardFilters {
  sortBy: LeaderboardSortBy;
  order: SortOrder;
}
