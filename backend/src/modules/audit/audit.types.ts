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

export interface AuditEntry {
  action: AuditAction;
  actor: string;
  target?: string;
  timestamp: string;
  ledger: number;
  details?: unknown;
}

export interface AuditPage {
  data: AuditEntry[];
  total: number;
  offset: number;
  limit: number;
}
