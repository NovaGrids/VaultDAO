# Real-Time Collaboration Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         VaultDAO Frontend                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    React Application                        │ │
│  │                                                              │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │           WebSocketProvider (Context)                 │  │ │
│  │  │  • Connection Management                              │  │ │
│  │  │  • Auto-reconnection                                  │  │ │
│  │  │  • Presence Broadcasting                              │  │ │
│  │  │  • Message Subscription                               │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                           │                                  │ │
│  │         ┌─────────────────┼─────────────────┐               │ │
│  │         │                 │                 │               │ │
│  │         ▼                 ▼                 ▼               │ │
│  │  ┌──────────┐      ┌──────────┐     ┌──────────┐          │ │
│  │  │ Presence │      │   Live   │     │  Typing  │          │ │
│  │  │Indicator │      │ Updates  │     │Indicator │          │ │
│  │  └──────────┘      └──────────┘     └──────────┘          │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────┘  │ │
│                                                                   │
└───────────────────────────┬───────────────────────────────────────┘
                            │
                            │ WebSocket Connection
                            │ ws://localhost:8080
                            │
┌───────────────────────────▼───────────────────────────────────────┐
│                    WebSocket Server (Node.js)                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Connection Manager                         │ │
│  │  • Client Registry (Map<address, WebSocket>)                 │ │
│  │  • Presence Tracking (Map<address, PresenceUser>)            │ │
│  │  • Message Routing                                            │ │
│  │  • Broadcast Logic                                            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Message Handlers                           │ │
│  │  • presence_update    → Broadcast to all                     │ │
│  │  • approval_added     → Broadcast to all                     │ │
│  │  • proposal_executed  → Broadcast to all                     │ │
│  │  • comment_typing     → Broadcast to proposal viewers        │ │
│  │  • cursor_move        → Broadcast to proposal viewers        │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Background Tasks                           │ │
│  │  • Stale Presence Cleanup (every 60s)                        │ │
│  │  • Server Stats Logging (every 5min)                         │ │
│  │  • Graceful Shutdown Handler                                 │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Message Flow

### 1. User Approves Proposal

```
Browser 1                    WebSocket Server              Browser 2
    │                              │                            │
    │ 1. User clicks "Approve"     │                            │
    ├──────────────────────────────┤                            │
    │                              │                            │
    │ 2. Optimistic UI Update      │                            │
    │    (immediate feedback)      │                            │
    │                              │                            │
    │ 3. API Call to Backend       │                            │
    ├─────────────────────────────►│                            │
    │                              │                            │
    │ 4. WebSocket Message         │                            │
    │    {type: "approval_added"}  │                            │
    ├─────────────────────────────►│                            │
    │                              │                            │
    │                              │ 5. Broadcast to Browser 2  │
    │                              ├───────────────────────────►│
    │                              │                            │
    │ 6. Confirm Optimistic Update │                            │
    │    (success)                 │                            │
    │                              │    6. Show Notification    │
    │                              │       Update UI            │
    │                              │                            │
```

### 2. Presence Update

```
Browser 1                    WebSocket Server              Browser 2
    │                              │                            │
    │ 1. Open Proposal #123        │                            │
    │                              │                            │
    │ 2. updatePresence("123")     │                            │
    ├─────────────────────────────►│                            │
    │                              │                            │
    │                              │ 3. Store in presence Map   │
    │                              │    address → {             │
    │                              │      viewingProposalId: 123│
    │                              │      lastSeen: timestamp   │
    │                              │    }                       │
    │                              │                            │
    │                              │ 4. Broadcast to all        │
    │                              ├───────────────────────────►│
    │                              │                            │
    │                              │    5. Update presence list │
    │                              │       Show user avatar     │
    │                              │                            │
```

### 3. Typing Indicator

```
Browser 1                    WebSocket Server              Browser 2
    │                              │                            │
    │ 1. User types in comment     │                            │
    │                              │                            │
    │ 2. setTyping(proposalId, true)│                           │
    ├─────────────────────────────►│                            │
    │                              │                            │
    │                              │ 3. Broadcast to viewers    │
    │                              ├───────────────────────────►│
    │                              │                            │
    │                              │    4. Show typing indicator│
    │                              │       "User is typing..."  │
    │                              │                            │
    │ 5. Stop typing (2s timeout)  │                            │
    ├─────────────────────────────►│                            │
    │                              │                            │
    │                              │ 6. Broadcast stop          │
    │                              ├───────────────────────────►│
    │                              │                            │
    │                              │    7. Hide indicator       │
    │                              │                            │
```

## Component Hierarchy

```
App
│
├── AccessibilityProvider
│   └── ToastProvider
│       └── WalletProvider
│           └── WebSocketProvider ◄─── NEW
│               │
│               ├── ConnectionStatusIndicator (fixed position)
│               │
│               └── BrowserRouter
│                   └── Routes
│                       └── DashboardLayout
│                           │
│                           ├── Header
│                           │   └── PresenceIndicator (compact)
│                           │
│                           └── Outlet
│                               │
│                               ├── Overview
│                               │
│                               ├── Proposals ◄─── UPDATED
│                               │   ├── PresenceIndicator
│                               │   ├── LiveUpdates
│                               │   └── ProposalCard[]
│                               │       └── onClick → ProposalDetailModal
│                               │
│                               ├── Activity
│                               │
│                               └── Settings
│
└── ProposalDetailModal ◄─── UPDATED
    ├── Header
    │   └── PresenceIndicator (compact)
    │
    ├── Tabs
    │   ├── Details
    │   │   ├── PresenceIndicator (full)
    │   │   └── LiveUpdates (proposal-specific)
    │   │
    │   └── Comments ◄─── UPDATED
    │       ├── TypingIndicator
    │       └── CommentThread
```

## State Management

```
┌─────────────────────────────────────────────────────────────┐
│                    WebSocketProvider State                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  connectionStatus: 'connecting' | 'connected' | 'error'      │
│  presenceUsers: Map<address, PresenceUser>                   │
│  wsRef: WebSocket | null                                     │
│  reconnectAttempts: number                                   │
│  subscribers: Set<(message) => void>                         │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                         Methods                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  sendMessage(message)                                         │
│  updatePresence(proposalId)                                  │
│  updateCursor(proposalId, position)                          │
│  setTyping(proposalId, isTyping)                             │
│  subscribe(callback) → unsubscribe                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Data Structures

### PresenceUser

```typescript
{
  address: string;              // "GABC...XYZ"
  viewingProposalId: string | null;  // "123" or null
  lastSeen: number;             // 1708704000000
  cursorPosition?: {            // Optional
    x: number;
    y: number;
  };
  isTyping?: boolean;           // Optional
}
```

### WebSocket Message

```typescript
{
  type: 'presence_update' | 'approval_added' | ...;
  // Type-specific fields
  proposalId?: string;
  user?: PresenceUser;
  approver?: string;
  // ... etc
}
```

## Network Protocol

### Connection Handshake

```
Client                                Server
  │                                     │
  │ 1. WebSocket Upgrade Request        │
  │    GET ws://localhost:8080          │
  │    ?address=GABC...XYZ              │
  ├────────────────────────────────────►│
  │                                     │
  │ 2. 101 Switching Protocols          │
  │◄────────────────────────────────────┤
  │                                     │
  │ 3. Connection Established           │
  │                                     │
  │ 4. Send presence_sync               │
  │    (current active users)           │
  │◄────────────────────────────────────┤
  │                                     │
  │ 5. Start heartbeat (30s)            │
  │    ping ──────────────────────────►│
  │    pong ◄──────────────────────────┤
  │                                     │
```

### Message Exchange

```
Client                                Server
  │                                     │
  │ User Action                         │
  │                                     │
  │ Send Message                        │
  ├────────────────────────────────────►│
  │                                     │
  │                                     │ Process
  │                                     │ Validate
  │                                     │ Store
  │                                     │
  │                                     │ Broadcast
  │                                     ├──────────► Client 2
  │                                     ├──────────► Client 3
  │                                     └──────────► Client N
  │                                     │
```

## Deployment Architecture

### Development

```
┌──────────────┐         ┌──────────────┐
│   Frontend   │         │  WebSocket   │
│              │         │    Server    │
│ localhost:   │◄───────►│              │
│   5173       │   WS    │ localhost:   │
│              │         │   8080       │
└──────────────┘         └──────────────┘
```

### Production

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Frontend   │         │ Load Balancer│         │  WebSocket   │
│              │         │              │         │   Cluster    │
│ Vercel/      │◄───────►│   Nginx/     │◄───────►│              │
│ Netlify      │  HTTPS  │   HAProxy    │   WSS   │ Docker/K8s   │
│              │         │              │         │              │
└──────────────┘         └──────────────┘         └──────┬───────┘
                                                          │
                                                          │
                                                   ┌──────▼───────┐
                                                   │    Redis     │
                                                   │  (Pub/Sub)   │
                                                   │              │
                                                   └──────────────┘
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Security Layers                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Transport Layer                                          │
│     • WSS (WebSocket Secure) with TLS 1.3                   │
│     • Certificate validation                                 │
│                                                               │
│  2. Authentication Layer                                     │
│     • Wallet address verification                            │
│     • Signature validation                                   │
│     • JWT tokens (optional)                                  │
│                                                               │
│  3. Authorization Layer                                      │
│     • Proposal access control                                │
│     • Action permissions                                     │
│     • Rate limiting                                          │
│                                                               │
│  4. Application Layer                                        │
│     • Input validation                                       │
│     • XSS prevention                                         │
│     • Message sanitization                                   │
│                                                               │
│  5. Network Layer                                            │
│     • DDoS protection                                        │
│     • Firewall rules                                         │
│     • IP whitelisting (optional)                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Performance Optimization

```
┌─────────────────────────────────────────────────────────────┐
│                   Optimization Strategies                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Frontend                                                     │
│  • Debounced typing (2s)                                     │
│  • Throttled cursor updates (100ms)                          │
│  • Memoized components (useMemo)                             │
│  • Optimistic updates                                        │
│  • Efficient re-renders (useCallback)                        │
│                                                               │
│  Backend                                                      │
│  • Connection pooling                                        │
│  • Message batching                                          │
│  • Presence cleanup (60s)                                    │
│  • Targeted broadcasting                                     │
│  • In-memory caching                                         │
│                                                               │
│  Network                                                      │
│  • Binary protocol (future)                                  │
│  • Message compression                                       │
│  • CDN for static assets                                     │
│  • Edge locations                                            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

This architecture provides:
- ✅ Scalability (horizontal scaling with Redis)
- ✅ Reliability (auto-reconnection, error handling)
- ✅ Performance (optimized updates, efficient broadcasting)
- ✅ Security (multiple layers of protection)
- ✅ Maintainability (clear separation of concerns)
