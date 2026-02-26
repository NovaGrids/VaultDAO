/**
 * Types for collaborative proposal editing
 */

export interface ProposalDraft {
  id: string;
  vaultId: string;
  recipient: string;
  token: string;
  amount: string;
  memo: string;
  createdBy: string;
  createdAt: number;
  lastModified: number;
  collaborators: string[];
  status: 'draft' | 'submitted';
}

export interface DraftVersion {
  id: string;
  draftId: string;
  version: number;
  recipient: string;
  token: string;
  amount: string;
  memo: string;
  changedBy: string;
  changedAt: number;
  changeDescription: string;
}

export interface UserChange {
  id: string;
  draftId: string;
  userId: string;
  userName: string;
  field: 'recipient' | 'token' | 'amount' | 'memo';
  oldValue: string;
  newValue: string;
  timestamp: number;
}

export interface DraftComment {
  id: string;
  draftId: string;
  userId: string;
  userName: string;
  content: string;
  field?: 'recipient' | 'token' | 'amount' | 'memo';
  timestamp: number;
  resolved: boolean;
}

export interface CollaboratorPresence {
  userId: string;
  userName: string;
  color: string;
  cursor?: {
    field: string;
    position: number;
  };
  lastSeen: number;
}
