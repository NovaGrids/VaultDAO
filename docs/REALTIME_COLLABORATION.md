# Real-Time Collaboration and Live Updates

## Overview

The VaultDAO application now includes comprehensive real-time collaboration features powered by WebSocket technology. Users can see live updates, track online users, receive instant notifications, and collaborate in real-time.

## Features

### 1. WebSocket Connection Management
- Automatic connection and reconnection with exponential backoff
- Heartbeat mechanism to keep connections alive
- Connection status tracking (connecting, connected, disconnected, error)
- Graceful handling of network interruptions

### 2. Online User Presence
- Real-time display of online users
- User status indicators (online, away, offline)
- Current page tracking for each user
- Automatic status updates based on page visibility
- Expandable user list with avatars

### 3. Live Updates
- Real-time proposal updates (created, approved, rejected, executed)
- Live activity feed updates
- Instant notification of changes
- Update history with timestamps
- Filterable update types

### 4. Typing Indicators
- Show when users are typing
- Automatic timeout after 3 seconds of inactivity
- Multiple user support
- Smooth animations

### 5. Real-Time Notifications
- Push notifications for important events
- Multiple notification types (info, success, warning, error)
- Auto-dismiss after 5 seconds
- Manual dismiss option
- Timestamp tracking

## Architecture

### WebSocket Client (`frontend/src/utils/websocket.ts`)

The WebSocket client provides a robust connection management system:

```typescript
const client = createWebSocketClient({
  url: 'ws://localhost:8080',
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
  onConnect: () => console.log('Connected'),
  onDisconnect: () => console.log('Disconnected'),
  onError: (error) => console.error('Error:', error),
});
```

Features:
- Automatic reconnection with exponential backoff
- Heartbeat to keep connection alive
- Type-safe message handling
- Status change notifications
- Subscription-based event system

### Realtime Context (`frontend/src/contexts/RealtimeContext.tsx`)

The Realtime Context provides a React context for managing WebSocket connections and real-time state:

```typescript
const { 
  isConnected, 
  connectionStatus, 
  onlineUsers, 
  subscribe, 
  sendUpdate, 
  updatePresence 
} = useRealtime();
```

Features:
- Global WebSocket connection management
- User presence tracking
- Event subscription system
- Automatic presence updates based on page visibility
- Type-safe message handling

## Components

### OnlineUsers (`frontend/src/components/OnlineUsers.tsx`)

Displays a list of currently online users with their status and current page.

Features:
- Expandable user list
- User avatars with status indicators
- Current page display
- Smooth animations
- Responsive design

### LiveUpdates (`frontend/src/components/LiveUpdates.tsx`)

Shows real-time updates for proposals and activities.

Features:
- Update history (last 10 updates)
- Type-specific icons
- Timestamp display
- Clear all functionality
- Collapsible interface

### TypingIndicator (`frontend/src/components/TypingIndicator.tsx`)

Displays when users are typing.

Features:
- Animated typing dots
- Multiple user support
- Automatic timeout
- Smooth animations

### RealtimeNotifications (`frontend/src/components/RealtimeNotifications.tsx`)

Displays push notifications for important events.

Features:
- Multiple notification types
- Auto-dismiss after 5 seconds
- Manual dismiss option
- Type-specific icons and colors
- Timestamp display

## Usage

### Basic Setup

The real-time system is automatically initialized in `main.tsx`:

```typescript
<RealtimeProvider>
  <App />
</RealtimeProvider>
```

### Subscribing to Events

In any component, use the `useRealtime` hook to subscribe to events:

```typescript
import { useRealtime } from '../contexts/RealtimeContext';

function MyComponent() {
  const { subscribe, updatePresence } = useRealtime();

  useEffect(() => {
    // Update presence when component mounts
    updatePresence('online', 'My Page');

    // Subscribe to events
    const unsubscribe = subscribe('proposal_created', (data) => {
      console.log('New proposal:', data);
    });

    // Cleanup
    return () => {
      unsubscribe();
    };
  }, [subscribe, updatePresence]);
}
```

### Sending Updates

To send updates to other users:

```typescript
const { sendUpdate } = useRealtime();

sendUpdate('proposal_created', {
  id: '123',
  title: 'New Proposal',
  amount: '1000',
});
```

### Available Event Types

- `proposal_created` - New proposal created
- `proposal_updated` - Proposal updated
- `proposal_approved` - Proposal approved
- `proposal_rejected` - Proposal rejected
- `activity_new` - New activity recorded
- `user_joined` - User joined
- `user_left` - User left
- `user_typing` - User is typing
- `notification` - Push notification
- `presence_update` - User presence updated

## Configuration

### Environment Variables

Set the WebSocket URL in your `.env` file:

```env
VITE_WS_URL=ws://localhost:8080
```

If not set, the system will use `ws://localhost:8080` as default.

### Development Mode

In development mode, WebSocket is disabled by default unless `VITE_WS_URL` is set. This prevents connection errors when no WebSocket server is running.

### Production Mode

In production, WebSocket is automatically enabled and will attempt to connect to the configured URL.

## Server Requirements

The real-time features require a WebSocket server that supports the following message format:

```typescript
interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: number;
  userId?: string;
}
```

### Required Server Endpoints

The server should handle the following message types:

- `ping` - Heartbeat (respond with `pong`)
- `presence_update` - User presence update
- `proposal_created` - Broadcast to all users
- `proposal_updated` - Broadcast to all users
- `proposal_approved` - Broadcast to all users
- `proposal_rejected` - Broadcast to all users
- `activity_new` - Broadcast to all users
- `user_typing` - Broadcast to all users
- `notification` - Send to specific user or broadcast

## Testing

### Manual Testing

1. Open the application in multiple browser windows
2. Connect with different user accounts
3. Create a proposal in one window
4. Observe real-time updates in other windows
5. Check online users list
6. Test typing indicators
7. Verify notifications

### Connection Testing

1. Start the application
2. Check browser console for WebSocket connection logs
3. Disconnect network
4. Observe reconnection attempts
5. Reconnect network
6. Verify automatic reconnection

## Troubleshooting

### Connection Issues

If WebSocket connection fails:

1. Check `VITE_WS_URL` environment variable
2. Verify WebSocket server is running
3. Check browser console for error messages
4. Verify firewall settings
5. Check CORS configuration on server

### Performance Issues

If experiencing performance issues:

1. Reduce `heartbeatInterval` in WebSocket config
2. Limit number of stored updates
3. Implement message throttling
4. Use message batching for multiple updates

### Browser Compatibility

WebSocket is supported in all modern browsers:
- Chrome 16+
- Firefox 11+
- Safari 7+
- Edge 12+
- Opera 12.1+

## Security Considerations

1. Always use WSS (WebSocket Secure) in production
2. Implement authentication and authorization
3. Validate all incoming messages
4. Sanitize user input
5. Implement rate limiting
6. Use CSRF tokens
7. Implement message encryption for sensitive data

## Future Enhancements

- [ ] End-to-end encryption for messages
- [ ] Voice and video chat
- [ ] Screen sharing
- [ ] Collaborative editing
- [ ] Message history persistence
- [ ] Offline message queue
- [ ] Push notifications (browser API)
- [ ] Mobile app support
- [ ] WebRTC for peer-to-peer communication

## Resources

- [WebSocket API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [WebSocket Protocol RFC 6455](https://tools.ietf.org/html/rfc6455)
- [React Context API](https://react.dev/reference/react/useContext)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
