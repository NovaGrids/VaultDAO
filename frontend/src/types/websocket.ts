// WebSocket message types for real-time collaboration

export type WebSocketMessageType =
  | 'presence_update'
  | 'proposal_updated'
  | 'approval_added'
  | 'proposal_executed'
  | 'proposal_rejected'
  | 'comment_typing'
  | 'conflict_detected'
  | 'cursor_move'
  | 'ping'
  | 'pong';

export interface PresenceUser {
  address: string;
  viewingProposalId: string | null;
  lastSeen: number;
  cursorPosition?: { x: number; y: number };
  isTyping?: boolean;
}

export interface WebSocketMessage {
  type: WebSocketMessageType;
  [key: string]: any;
}

export interface PresenceUpdateMessage extends WebSocketMessage {
  type: 'presence_update';
  user: PresenceUser;
}

export interface ProposalUpdatedMessage extends WebSocketMessage {
  type: 'proposal_updated';
  proposalId: string;
  action: string;
  actor: string;
}

export interface ApprovalAddedMessage extends WebSocketMessage {
  type: 'approval_added';
  proposalId: string;
  approver: string;
}

export interface ProposalExecutedMessage extends WebSocketMessage {
  type: 'proposal_executed';
  proposalId: string;
  executor: string;
}

export interface ProposalRejectedMessage extends WebSocketMessage {
  type: 'proposal_rejected';
  proposalId: string;
  rejector: string;
}

export interface CommentTypingMessage extends WebSocketMessage {
  type: 'comment_typing';
  proposalId: string;
  user: string;
  isTyping: boolean;
}

export interface ConflictDetectedMessage extends WebSocketMessage {
  type: 'conflict_detected';
  proposalId: string;
  conflictingUsers: string[];
}

export interface CursorMoveMessage extends WebSocketMessage {
  type: 'cursor_move';
  proposalId: string;
  user: string;
  position: { x: number; y: number };
}
