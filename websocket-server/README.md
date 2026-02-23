# VaultDAO WebSocket Server

Simple WebSocket server for real-time collaboration features.

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start

# Or with auto-reload for development
npm run dev
```

The server will run on `ws://localhost:8080`

## Features

- ✅ Connection management with address-based authentication
- ✅ Presence tracking and broadcasting
- ✅ Real-time message routing
- ✅ Automatic stale presence cleanup
- ✅ Graceful shutdown handling
- ✅ Error handling and logging

## Message Types

### Client → Server

- `ping`: Heartbeat check
- `presence_update`: User presence information
- `approval_added`: Proposal approval notification
- `proposal_executed`: Proposal execution notification
- `proposal_rejected`: Proposal rejection notification
- `comment_typing`: Typing indicator
- `cursor_move`: Cursor position update
- `proposal_updated`: General proposal update

### Server → Client

- `pong`: Heartbeat response
- `presence_sync`: Initial presence data on connection
- `error`: Error message
- All client message types (broadcasted to other users)

## Configuration

Set environment variables:

```bash
PORT=8080  # WebSocket server port
```

## Production Deployment

For production, consider:

1. **Use Socket.io with Redis** for horizontal scaling
2. **Add authentication** with JWT tokens
3. **Implement rate limiting** to prevent abuse
4. **Use WSS (secure WebSocket)** with SSL/TLS
5. **Add monitoring** with Prometheus/Grafana
6. **Deploy with Docker** for easy scaling

## Docker Deployment

```bash
# Build image
docker build -t vaultdao-ws .

# Run container
docker run -p 8080:8080 vaultdao-ws
```

## Testing

```bash
# Using wscat
npm install -g wscat
wscat -c "ws://localhost:8080?address=GABC123XYZ"

# Send test message
> {"type":"presence_update","user":{"address":"GABC123XYZ","viewingProposalId":"1","lastSeen":1234567890}}
```

## Monitoring

The server logs:
- Connection/disconnection events
- Message broadcasts
- Stale presence cleanup
- Server statistics (every 5 minutes)

## License

MIT
