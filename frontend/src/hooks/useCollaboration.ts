import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { ProposalDraft, CollaboratorPresence } from '../types/collaboration';

const WEBSOCKET_URL = import.meta.env.VITE_COLLAB_WS_URL || 'ws://localhost:1234';

interface UseCollaborationOptions {
  draftId: string;
  userId: string;
  userName: string;
  onSync?: (draft: Partial<ProposalDraft>) => void;
  onError?: (error: Error) => void;
}

interface SharedDraft {
  recipient: Y.Text;
  token: Y.Text;
  amount: Y.Text;
  memo: Y.Text;
  metadata: Y.Map<any>;
}

export function useCollaboration({
  draftId,
  userId,
  userName,
  onSync,
  onError,
}: UseCollaborationOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  const [hasConflict, setHasConflict] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const sharedRef = useRef<SharedDraft | null>(null);

  // Initialize Yjs document and WebSocket provider
  useEffect(() => {
    try {
      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      // Create shared types for each field
      const yRecipient = ydoc.getText('recipient');
      const yToken = ydoc.getText('token');
      const yAmount = ydoc.getText('amount');
      const yMemo = ydoc.getText('memo');
      const yMetadata = ydoc.getMap('metadata');

      sharedRef.current = {
        recipient: yRecipient,
        token: yToken,
        amount: yAmount,
        memo: yMemo,
        metadata: yMetadata,
      };

      // Initialize WebSocket provider
      const provider = new WebsocketProvider(WEBSOCKET_URL, `draft-${draftId}`, ydoc, {
        connect: true,
        awareness: true,
      });
      providerRef.current = provider;

      // Set user awareness with color
      provider.awareness.setLocalStateField('user', {
        userId,
        userName,
        color: generateUserColor(userId),
        lastActive: Date.now(),
      });

      // Connection status handlers
      provider.on('status', (event: { status: string }) => {
        setIsConnected(event.status === 'connected');
      });

      // Sync progress
      provider.on('sync', (isSynced: boolean) => {
        if (isSynced) {
          setSyncProgress(100);
          if (onSync) {
            onSync({
              recipient: yRecipient.toString(),
              token: yToken.toString(),
              amount: yAmount.toString(),
              memo: yMemo.toString(),
            });
          }
        } else {
          setSyncProgress(50);
        }
      });

      // Awareness changes (collaborator presence)
      const updateCollaborators = () => {
        const states = Array.from(provider.awareness.getStates().entries());
        const presences: CollaboratorPresence[] = states
          .filter(([clientId]) => clientId !== provider.awareness.clientID)
          .map(([, state]) => ({
            userId: state.user?.userId || '',
            userName: state.user?.userName || 'Anonymous',
            color: state.user?.color || '#888',
            cursor: state.cursor,
            lastSeen: state.user?.lastActive || Date.now(),
          }));
        setCollaborators(presences);
      };

      provider.awareness.on('change', updateCollaborators);

      // Conflict detection: track recent edits
      const conflictDetector = () => {
        const recentChanges = yMetadata.get('recentChanges') as any[] || [];
        const now = Date.now();
        const conflictWindow = 5000; // 5 seconds
        
        const hasRecentConflict = recentChanges.some((change: any) => 
          change.userId !== userId && (now - change.timestamp) < conflictWindow
        );
        setHasConflict(hasRecentConflict);
      };

      ydoc.on('update', conflictDetector);

      // Cleanup
      return () => {
        provider.disconnect();
        ydoc.destroy();
      };
    } catch (error) {
      if (onError && error instanceof Error) {
        onError(error);
      }
    }
  }, [draftId, userId, userName, onSync, onError]);

  // Update field value with transaction
  const updateField = useCallback((field: 'recipient' | 'token' | 'amount' | 'memo', value: string) => {
    if (!ydocRef.current || !sharedRef.current) return;

    const yText = sharedRef.current[field];
    const currentValue = yText.toString();
    
    if (currentValue !== value) {
      ydocRef.current.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, value);

        // Track change in metadata for conflict detection
        const yMetadata = sharedRef.current!.metadata;
        const recentChanges = (yMetadata.get('recentChanges') as any[]) || [];
        recentChanges.push({
          userId,
          field,
          timestamp: Date.now(),
        });
        // Keep last 20 changes
        yMetadata.set('recentChanges', recentChanges.slice(-20));
      });
    }
  }, [userId]);

  // Update cursor position for awareness
  const updateCursor = useCallback((field: string, position: number) => {
    if (!providerRef.current) return;
    providerRef.current.awareness.setLocalStateField('cursor', { 
      field, 
      position,
      timestamp: Date.now(),
    });
  }, []);

  // Get current draft state
  const getDraftState = useCallback((): Partial<ProposalDraft> | null => {
    if (!sharedRef.current) return null;
    return {
      recipient: sharedRef.current.recipient.toString(),
      token: sharedRef.current.token.toString(),
      amount: sharedRef.current.amount.toString(),
      memo: sharedRef.current.memo.toString(),
    };
  }, []);

  // Undo/Redo support
  const undo = useCallback(() => {
    if (ydocRef.current) {
      // Yjs doesn't have built-in undo, but we can track history
      // This is a placeholder for future enhancement
    }
  }, []);

  const redo = useCallback(() => {
    if (ydocRef.current) {
      // Placeholder for future enhancement
    }
  }, []);

  return {
    isConnected,
    collaborators,
    hasConflict,
    syncProgress,
    updateField,
    updateCursor,
    getDraftState,
    undo,
    redo,
  };
}

// Generate consistent color for user based on userId
function generateUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
    '#F8B88B', '#A8E6CF', '#FFD3B6', '#FFAAA5',
  ];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}
