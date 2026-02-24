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
}

export function useCollaboration({
  draftId,
  userId,
  userName,
  onSync,
}: UseCollaborationOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  const [hasConflict, setHasConflict] = useState(false);
  
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Yjs document and WebSocket provider
  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Create shared types for each field
    const yRecipient = ydoc.getText('recipient');
    const yToken = ydoc.getText('token');
    const yAmount = ydoc.getText('amount');
    const yMemo = ydoc.getText('memo');
    const yMetadata = ydoc.getMap('metadata');

    // Initialize WebSocket provider
    const provider = new WebsocketProvider(WEBSOCKET_URL, draftId, ydoc, {
      connect: true,
    });
    providerRef.current = provider;

    // Set user awareness
    provider.awareness.setLocalStateField('user', {
      userId,
      userName,
      color: generateUserColor(userId),
    });

    // Connection status handlers
    provider.on('status', (event: { status: string }) => {
      setIsConnected(event.status === 'connected');
    });

    provider.on('sync', (isSynced: boolean) => {
      if (isSynced && onSync) {
        onSync({
          recipient: yRecipient.toString(),
          token: yToken.toString(),
          amount: yAmount.toString(),
          memo: yMemo.toString(),
        });
      }
    });

    // Awareness changes (collaborator presence)
    provider.awareness.on('change', () => {
      const states = Array.from(provider.awareness.getStates().entries());
      const presences: CollaboratorPresence[] = states
        .filter(([clientId]) => clientId !== provider.awareness.clientID)
        .map(([, state]) => ({
          userId: state.user?.userId || '',
          userName: state.user?.userName || 'Anonymous',
          color: state.user?.color || '#888',
          cursor: state.cursor,
          lastSeen: Date.now(),
        }));
      setCollaborators(presences);
    });

    // Conflict detection
    ydoc.on('update', () => {
      // Simple conflict detection: check if multiple users edited same field recently
      const recentChanges = yMetadata.get('recentChanges') as any[] || [];
      const now = Date.now();
      const conflictWindow = 5000; // 5 seconds
      
      const hasRecentConflict = recentChanges.some((change: any) => 
        change.userId !== userId && (now - change.timestamp) < conflictWindow
      );
      setHasConflict(hasRecentConflict);
    });

    return () => {
      provider.disconnect();
      ydoc.destroy();
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [draftId, userId, userName, onSync]);

  // Update field value
  const updateField = useCallback((field: 'recipient' | 'token' | 'amount' | 'memo', value: string) => {
    if (!ydocRef.current) return;

    const yText = ydocRef.current.getText(field);
    const currentValue = yText.toString();
    
    if (currentValue !== value) {
      ydocRef.current.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, value);

        // Track change in metadata
        const yMetadata = ydocRef.current!.getMap('metadata');
        const recentChanges = yMetadata.get('recentChanges') as any[] || [];
        recentChanges.push({
          userId,
          field,
          timestamp: Date.now(),
        });
        yMetadata.set('recentChanges', recentChanges.slice(-10)); // Keep last 10 changes
      });
    }
  }, [userId]);

  // Get current field value
  const getField = useCallback((field: 'recipient' | 'token' | 'amount' | 'memo'): string => {
    if (!ydocRef.current) return '';
    return ydocRef.current.getText(field).toString();
  }, []);

  // Update cursor position for awareness
  const updateCursor = useCallback((field: string, position: number) => {
    if (!providerRef.current) return;
    providerRef.current.awareness.setLocalStateField('cursor', { field, position });
  }, []);

  return {
    isConnected,
    collaborators,
    hasConflict,
    updateField,
    getField,
    updateCursor,
  };
}

// Generate consistent color for user
function generateUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
  ];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}
