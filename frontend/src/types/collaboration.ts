export interface ProposalDraft {
  recipient: string;
  token: string;
  amount: string;
  memo: string;
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

export interface CollaboratorPresence {
  userId: string;
  userName: string;
  color: string;
  cursor: { field: string; position: number; timestamp: number; isTyping?: boolean } | null;
  lastSeen: number;
}