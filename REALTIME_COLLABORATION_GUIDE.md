# Real-Time Collaboration Feature Guide

## 🚀 Quick Start

### 1. Install Dependencies
All required dependencies are already in `package.json`. No additional packages needed.

### 2. Configure Environment
Create a `.env` file in the `frontend` directory:

```bash
cp frontend/.env.example frontend/.env
```

Edit the WebSocket URL:
```env
VITE_WS_URL=ws://localhost:8080
```

### 3. Start the Application
```bash
cd frontend
npm install
npm run dev
```

### 4. Set Up WebSocket Server
You'll need a WebSocket server running on port 8080. See [Backend Setup](#backend-setup) below.

## 📋 Features

### ✅ Implemented Features

1. **WebSocket Connection Management**
   - Auto-reconnection with exponential backoff
   - Heartbeat mechanism (30s interval)
   - Connection status tracking
   - Graceful degradation

2. **Live Presence Indicators**
   - Shows who's viewing each proposal
   - Color-coded user avatars
   - Real-time typing indicators
   - Active user count

3. **Real-Time Updates**
   - Live approval notifications
   - Execution/rejection alerts
   - Comment activity updates
   - Conflict detection warnings

4. **Typing Indicators**
   - Shows who's typing in comments
   - Animated visual feedback
   - 2-second inactivity timeout

5. **Connection Status**
   - Fixed position indicator
   - Expandable details panel
   - Error state handling
   - Mobile responsive

6. **Optimistic Updates**
   - Immediate UI feedback
   - Automatic rollback on failure
   - Visual pending indicators

## 🏗️ Architecture

### Component Hierarchy

```
App
└── WebSocketProvider (Context)
    ├── DashboardLayout
    │   ├── Header
    │   │   └── PresenceIndicator (compact)
    │   └── Outlet
    │       └── Proposals
    │           ├── PresenceIndicator
    │           ├── LiveUpdates
    │           └── ProposalDetailModal
    │               ├── PresenceIndicator
    │               ├── LiveUpdates
    │               └── ProposalComments
    │                   └── TypingIndicator
    └── ConnectionStatusIndicator (fixed position)
```

### Data Flow

```
User Action → Optimistic Update → API Call → WebSocket Broadcast
                    ↓                  ↓              ↓
              UI Updates         Confirm/Rollback   Other Users
```

## 🔧 Backend Setup

### Option 1: Node.js + ws

```javascript
// server.js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const clients = new Map(); // address -> WebSocket
const presence = new Map(); // address -> PresenceUser

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'ws://localhost');
  const address = url.searchParams.get('address');
  
  if (!address) {
    ws.close();
    return;
  }
  
  clients.set(address, ws);
  console.log(`User connected: ${address}`);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle ping/pong
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      
      // Update presence
      if (message.type === 'presence_update') {
        presence.set(address, message.user);
      }
      
      // Broadcast to all clients
      broadcast(message, address);
    } catch (error) {
      console.error('Message parse error:', error);
    }
  });
  
  ws.on('close', () => {
    clients.delete(address);
    presence.delete(address);
    console.log(`User disconnected: ${address}`);
    
    // Notify others
    broadcast({
      type: 'presence_update',
      user: { address, viewingProposalId: null, lastSeen: Date.now() }
    }, address);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function broadcast(message, senderAddress) {
  const data = JSON.stringify(message);
  
  clients.forEach((client, address) => {
    if (client.readyState === WebSocket.OPEN) {
      // Optionally filter by proposal ID for efficiency
      client.send(data);
    }
  });
}

// Cleanup stale presence every minute
setInterval(() => {
  const now = Date.now();
  presence.forEach((user, address) => {
    if (now - user.lastSeen > 60000) {
      presence.delete(address);
    }
  });
}, 60000);

console.log('WebSocket server running on ws://localhost:8080');
```

Run the server:
```bash
npm install ws
node server.js
```

### Option 2: Python + websockets

```python
# server.py
import asyncio
import json
import websockets
from urllib.parse import urlparse, parse_qs

clients = {}  # address -> websocket
presence = {}  # address -> presence_data

async def handler(websocket, path):
    # Extract address from query params
    query = parse_qs(urlparse(path).query)
    address = query.get('address', [None])[0]
    
    if not address:
        await websocket.close()
        return
    
    clients[address] = websocket
    print(f"User connected: {address}")
    
    try:
        async for message in websocket:
            data = json.loads(message)
            
            # Handle ping/pong
            if data.get('type') == 'ping':
                await websocket.send(json.dumps({'type': 'pong'}))
                continue
            
            # Update presence
            if data.get('type') == 'presence_update':
                presence[address] = data.get('user')
            
            # Broadcast to all clients
            await broadcast(data, address)
    
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        del clients[address]
        if address in presence:
            del presence[address]
        print(f"User disconnected: {address}")
        
        # Notify others
        await broadcast({
            'type': 'presence_update',
            'user': {'address': address, 'viewingProposalId': None, 'lastSeen': int(time.time() * 1000)}
        }, address)

async def broadcast(message, sender_address):
    data = json.dumps(message)
    
    for address, websocket in list(clients.items()):
        try:
            await websocket.send(data)
        except:
            pass

async def main():
    async with websockets.serve(handler, "localhost", 8080):
        print("WebSocket server running on ws://localhost:8080")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
```

Run the server:
```bash
pip install websockets
python server.py
```

### Option 3: Production Setup (Socket.io + Redis)

For production, consider using Socket.io with Redis for horizontal scaling:

```javascript
// server.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const redis = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*' }
});

const pubClient = redis.createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
});

io.on('connection', (socket) => {
  const address = socket.handshake.query.address;
  
  if (!address) {
    socket.disconnect();
    return;
  }
  
  socket.join(`user:${address}`);
  console.log(`User connected: ${address}`);
  
  socket.on('message', (data) => {
    // Broadcast to all clients
    io.emit('message', data);
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${address}`);
  });
});

server.listen(8080, () => {
  console.log('Server running on port 8080');
});
```

## 📱 Mobile Responsiveness

All components are fully responsive:

### Breakpoints
- **Mobile**: < 768px
- **Tablet**: 768px - 1024px
- **Desktop**: > 1024px

### Mobile Optimizations
- Compact presence indicators
- Touch-friendly 44x44px targets
- Stacked layouts
- Simplified UI
- Swipe gestures support

### Testing
```bash
# Chrome DevTools
1. Open DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Test various devices:
   - iPhone SE (375px)
   - iPhone 12 Pro (390px)
   - iPad (768px)
   - iPad Pro (1024px)
```

## 🧪 Testing

### Manual Testing Checklist

#### Connection Management
- [ ] Connect wallet and verify WebSocket connects
- [ ] Disconnect wallet and verify WebSocket disconnects
- [ ] Simulate network interruption (DevTools offline)
- [ ] Verify auto-reconnection works
- [ ] Check heartbeat keeps connection alive

#### Presence Indicators
- [ ] Open proposal in two browsers
- [ ] Verify both users appear in presence list
- [ ] Close one browser, verify user disappears
- [ ] Check color-coded avatars are unique
- [ ] Verify last seen timestamps update

#### Real-Time Updates
- [ ] Approve proposal in one browser
- [ ] Verify notification appears in other browser
- [ ] Check proposal status updates immediately
- [ ] Test rejection, execution flows
- [ ] Verify conflict detection works

#### Typing Indicators
- [ ] Start typing comment in one browser
- [ ] Verify typing indicator appears in other browser
- [ ] Stop typing, verify indicator disappears after 2s
- [ ] Test multiple users typing simultaneously

#### Optimistic Updates
- [ ] Approve proposal with network throttled
- [ ] Verify immediate UI update
- [ ] Simulate failure, check rollback
- [ ] Verify success confirmation

#### Mobile Responsiveness
- [ ] Test on iPhone SE (375px width)
- [ ] Test on iPad (768px width)
- [ ] Test landscape orientation
- [ ] Verify touch targets are 44x44px minimum
- [ ] Check text is readable at 200% zoom

### Automated Testing

```typescript
// Example test with React Testing Library
import { render, screen, waitFor } from '@testing-library/react';
import { WebSocketProvider } from './context/WebSocketProvider';
import PresenceIndicator from './components/PresenceIndicator';

describe('PresenceIndicator', () => {
  it('shows active users', async () => {
    const mockWs = new MockWebSocket();
    
    render(
      <WebSocketProvider>
        <PresenceIndicator proposalId="1" />
      </WebSocketProvider>
    );
    
    // Simulate presence update
    mockWs.emit('message', {
      type: 'presence_update',
      user: {
        address: 'GABC...XYZ',
        viewingProposalId: '1',
        lastSeen: Date.now()
      }
    });
    
    await waitFor(() => {
      expect(screen.getByText(/GABC/)).toBeInTheDocument();
    });
  });
});
```

## 🔒 Security

### Best Practices

1. **Authentication**
   - Verify wallet signatures on connection
   - Use JWT tokens for session management
   - Validate address ownership

2. **Authorization**
   - Check user permissions before broadcasting
   - Filter messages by proposal access
   - Rate limit message frequency

3. **Input Validation**
   - Sanitize all user input
   - Validate message structure
   - Prevent XSS attacks

4. **Connection Security**
   - Use WSS (WebSocket Secure) in production
   - Implement CORS properly
   - Add DDoS protection

### Example: Secure Connection

```typescript
// WebSocketProvider.tsx
const connect = useCallback(() => {
  // Sign a challenge to prove wallet ownership
  const challenge = generateChallenge();
  const signature = await signChallenge(challenge, address);
  
  const ws = new WebSocket(
    `${wsUrl}?address=${address}&signature=${signature}&challenge=${challenge}`
  );
  
  // ... rest of connection logic
}, [address, wsUrl]);
```

## 🐛 Troubleshooting

### Common Issues

#### 1. WebSocket Won't Connect

**Symptoms**: Connection status shows "error" or "disconnected"

**Solutions**:
- Check WebSocket server is running: `curl http://localhost:8080`
- Verify VITE_WS_URL in .env file
- Check browser console for errors
- Ensure wallet is connected
- Try different port if 8080 is in use

#### 2. Presence Not Updating

**Symptoms**: Users don't appear in presence list

**Solutions**:
- Check WebSocket connection is active
- Verify presence_update messages are being sent
- Check server is broadcasting messages
- Clear browser cache and reload
- Check for JavaScript errors in console

#### 3. Typing Indicator Stuck

**Symptoms**: Typing indicator doesn't disappear

**Solutions**:
- Check 2-second timeout is working
- Verify setTyping is called with false
- Check WebSocket messages are being sent
- Reload the page

#### 4. Optimistic Updates Not Rolling Back

**Symptoms**: Failed actions show as successful

**Solutions**:
- Check error handling in try/catch blocks
- Verify rollbackOptimistic is called
- Check API error responses
- Add console.log to debug flow

#### 5. Mobile Layout Issues

**Symptoms**: UI looks broken on mobile

**Solutions**:
- Check Tailwind breakpoints (md:, lg:)
- Verify viewport meta tag in index.html
- Test with Chrome DevTools device mode
- Check for fixed widths that should be responsive

### Debug Mode

Enable debug logging:

```typescript
// WebSocketProvider.tsx
const DEBUG = true;

if (DEBUG) {
  console.log('WebSocket message:', message);
  console.log('Presence users:', presenceUsers);
  console.log('Connection status:', connectionStatus);
}
```

## 📊 Performance

### Metrics to Monitor

1. **Connection Latency**: < 100ms
2. **Message Delivery**: < 50ms
3. **Reconnection Time**: < 3s
4. **Memory Usage**: < 50MB per user
5. **CPU Usage**: < 5% idle

### Optimization Tips

1. **Throttle Updates**: Don't send every keystroke
2. **Batch Messages**: Combine multiple updates
3. **Use Binary Protocol**: For large data transfers
4. **Implement Pagination**: For large presence lists
5. **Cache Presence Data**: Reduce server queries

### Load Testing

```bash
# Using artillery
npm install -g artillery

# Create load-test.yml
artillery run load-test.yml
```

```yaml
# load-test.yml
config:
  target: "ws://localhost:8080"
  phases:
    - duration: 60
      arrivalRate: 10
  engines:
    ws:
      timeout: 30

scenarios:
  - engine: ws
    flow:
      - connect:
          query:
            address: "{{ $randomString() }}"
      - send:
          payload: '{"type":"presence_update","user":{"address":"test","viewingProposalId":"1","lastSeen":1234567890}}'
      - think: 5
```

## 🚀 Deployment

### Frontend Deployment

```bash
# Build for production
cd frontend
npm run build

# Deploy to Vercel
vercel deploy

# Or Netlify
netlify deploy --prod
```

### Backend Deployment

#### Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t websocket-server .
docker run -p 8080:8080 websocket-server
```

#### Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: websocket-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: websocket-server
  template:
    metadata:
      labels:
        app: websocket-server
    spec:
      containers:
      - name: websocket-server
        image: websocket-server:latest
        ports:
        - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: websocket-service
spec:
  type: LoadBalancer
  ports:
  - port: 8080
    targetPort: 8080
  selector:
    app: websocket-server
```

### Environment Variables

```bash
# Production .env
VITE_WS_URL=wss://ws.yourdomain.com
VITE_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
VITE_RPC_URL=https://soroban-mainnet.stellar.org
```

## 📚 Additional Resources

- [WebSocket API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Socket.io Documentation](https://socket.io/docs/v4/)
- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [React Context API](https://react.dev/reference/react/useContext)
- [Tailwind CSS](https://tailwindcss.com/docs)

## 🤝 Contributing

When adding new real-time features:

1. Add message type to `frontend/src/types/websocket.ts`
2. Handle message in `WebSocketProvider.tsx`
3. Create UI component if needed
4. Update this documentation
5. Add tests
6. Update backend server

## 📝 License

This feature is part of the VaultDAO project and follows the same license.

---

**Need Help?** Open an issue or contact the development team.
