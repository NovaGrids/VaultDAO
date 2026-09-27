import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCollaboration } from '../useCollaboration';
import * as Y from 'yjs';

// The hook constructs the provider with `new`, so the mock implementation must
// be a regular function (arrow functions are not constructible). The most
// recent instance is captured for tests to drive awareness events.
const providers = vi.hoisted(() => ({ last: null as null | { _triggerAwarenessChange: () => void } }));

// Mock y-websocket
vi.mock('y-websocket', () => ({
  WebsocketProvider: vi.fn().mockImplementation(function () {
    let awarenessChangeCb: any = null;
    const provider = {
      awareness: {
        setLocalStateField: vi.fn(),
        getStates: vi.fn().mockReturnValue(new Map([
          [2, { user: { userId: 'user2', userName: 'User 2', color: '#fff' }, cursor: { field: 'amount', position: 2, isTyping: true, timestamp: Date.now() } }]
        ])),
        on: vi.fn((event, cb) => {
          if (event === 'change') {
            awarenessChangeCb = cb;
          }
        }),
        clientID: 1,
      },
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      _triggerAwarenessChange: () => {
        if (awarenessChangeCb) awarenessChangeCb();
      }
    };
    providers.last = provider;
    return provider;
  }),
}));

describe('useCollaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    providers.last = null;
  });

  it('should initialize and connect when enabled', () => {
    const { result } = renderHook(() =>
      useCollaboration({
        draftId: 'test-draft',
        userId: 'user1',
        userName: 'User 1',
        enabled: true,
      })
    );

    expect(result.current.isConnected).toBe(false);
  });

  it('should save to localStorage as fallback on updateField', () => {
    const { result } = renderHook(() =>
      useCollaboration({
        draftId: 'test-draft',
        userId: 'user1',
        userName: 'User 1',
        enabled: false,
      })
    );

    act(() => {
      result.current.updateField('recipient', 'G123');
    });

    const saved = JSON.parse(localStorage.getItem('draft-test-draft') || '{}');
    expect(saved.recipient).toBe('G123');
  });

  it('should detect typing indicator and state syncs', () => {
    const { result } = renderHook(() =>
      useCollaboration({
        draftId: 'test-draft',
        userId: 'user1',
        userName: 'User 1',
        enabled: true,
      })
    );

    // Trigger the mock awareness change
    act(() => {
      expect(providers.last).not.toBeNull();
      providers.last!._triggerAwarenessChange();
    });

    expect(result.current.collaborators.length).toBe(1);
    expect(result.current.collaborators[0].cursor?.isTyping).toBe(true);
    expect(result.current.collaborators[0].cursor?.field).toBe('amount');
  });

  it('should sync yjs state accurately between two clients', () => {
    // This specifically tests Yjs core CRDT capabilities used by the hook
    const client1Doc = new Y.Doc();
    const client2Doc = new Y.Doc();

    // Simulate network relay
    client1Doc.on('update', (update) => Y.applyUpdate(client2Doc, update));
    client2Doc.on('update', (update) => Y.applyUpdate(client1Doc, update));

    // Client 1 types in the recipient field
    const client1Recipient = client1Doc.getText('recipient');
    client1Recipient.insert(0, 'G12345XYZ');

    // Assert Client 2 receives and merges the CRDT state
    const client2Recipient = client2Doc.getText('recipient');
    expect(client2Recipient.toString()).toBe('G12345XYZ');
  });
});