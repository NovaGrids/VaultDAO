// frontend/src/components/types.ts

export const ProposalStatus = {
  Pending: 'Pending',
  Approved: 'Approved',
  Executed: 'Executed',
  Rejected: 'Rejected',
} as const;

export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export interface Proposal {
  id: number;
  proposer: string;
  recipient: string;
  amount: string;
  status: ProposalStatus;
  description?: string;
  createdAt: number;
  unlockTime?: number;
  votesFor?: number;
  votesAgainst?: number;
}
