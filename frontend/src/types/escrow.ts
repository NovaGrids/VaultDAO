/**
 * Escrow and Milestone types for the VaultDAO frontend.
 * Mirrors the backend event data shapes and SDK Escrow type.
 */

export type EscrowStatus = 'active' | 'released' | 'disputed' | 'resolved' | 'expired';
export type MilestoneStatus = 'pending' | 'submitted' | 'verified' | 'rejected';
export type DisputeStatus = 'none' | 'open' | 'resolved';

export interface Milestone {
  index: number;
  description: string;
  requiredVerifiers: number;
  verifications: string[]; // addresses that have verified
  status: MilestoneStatus;
  amount: string; // portion of total amount for this milestone
}

export interface EscrowDispute {
  status: DisputeStatus;
  disputer?: string;
  reason?: string;
  resolvedBy?: string;
  releasedToRecipient?: boolean;
}

export interface Escrow {
  id: string;
  funder: string;
  recipient: string;
  token: string;
  amount: string; // total amount in stroops
  releasedAmount: string;
  arbitrator: string;
  durationLedgers: number;
  createdAt: string; // ISO timestamp
  status: EscrowStatus;
  milestones: Milestone[];
  dispute: EscrowDispute;
}

export interface EscrowFilters {
  status?: EscrowStatus | 'all';
  role?: 'funder' | 'recipient' | 'all';
}
