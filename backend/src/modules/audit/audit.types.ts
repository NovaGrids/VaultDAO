export enum AuditAction {
  ProposalCreated = "ProposalCreated",
  ProposalExecuted = "ProposalExecuted",
  ProposalCancelled = "ProposalCancelled",
  SignerAdded = "SignerAdded",
  SignerRemoved = "SignerRemoved",
  ThresholdChanged = "ThresholdChanged",
  RoleAssigned = "RoleAssigned",
  RoleRevoked = "RoleRevoked",
  FundsDeposited = "FundsDeposited",
  FundsWithdrawn = "FundsWithdrawn",
}

// Maps AuditAction string to on-chain u32 discriminant (matches Rust AuditAction enum)
export const AUDIT_ACTION_DISCRIMINANT: Record<string, number> = {
  Initialize: 0,
  ProposeTransfer: 1,
  ApproveProposal: 2,
  ExecuteProposal: 3,
  RejectProposal: 4,
  SetRole: 5,
  AddSigner: 6,
  RemoveSigner: 7,
  UpdateLimits: 8,
  UpdateThreshold: 9,
  AbstainProposal: 10,
  AmendProposal: 11,
};

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  prev_hash: string;
  hash: string;
  // legacy optional fields
  ledger?: number;
  details?: unknown;
}

export interface AuditVerificationResult {
  verified: boolean;
  brokenAtEntry: number | null;
}

export interface AuditPage {
  data: AuditEntry[];
  total: number;
  offset: number;
  limit: number;
  verification?: AuditVerificationResult;
}
