/**
 * Simple WebSocket Server for VaultDAO Real-Time Collaboration
 * 
 * This is a basic implementation for development/testing.
 * For production, consider using Socket.io with Redis for horizontal scaling.
 */

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Store connected clients: address -> WebSocket
const clients = new Map();

// Store presence data: address -> PresenceUser
const presence = new Map();

// Message handlers
const messageHandlers = {
  ping: (ws) => {
    ws.send(JSON.stringify({ type: 'pong' }));
  },
  
  presence_update: (message, address) => {
    presence.set(address, message.user);
    broadcast(message, address);
  },
  
  approval_added: (message, address) => {
    console.log(`Approval added by ${address} for proposal ${message.proposalId}`);
    broadcast(message, address);
  },
  
  proposal_executed: (message, address) => {
    console.log(`Proposal ${message.proposalId} executed by ${address}`);
    broadcast(message, address);
  },
  
  proposal_rejected: (message, address) => {
    console.log(`Proposal ${message.proposalId} rejected by ${address}`);
    broadcast(message, address);
  },
  
  comment_typing: (message, address) => {
    broadcast(message, address);
  },
  
  cursor_move: (message, address) => {
    // Only broadcast to users viewing the same proposal
    broadcastToProposal(message, message.proposalId, address);
  },
  
  proposal_updated: (message, address) => {
    console.log(`Proposal ${message.proposalId} updated by ${address}`);
    broadcast(message, address);
  }
};

wss.on('connection', (ws, req) => {
  // Extract address from query parameters
  const url = new URL(req.url, `ws://localhost:${PORT}`);
  const address = url.searchParams.get('address');
  
  if (!address) {
    console.error('Connection rejected: No address provided');
    ws.close(1008, 'Address required');
    return;
  }
  
  // Store client connection
  clients.set(address, ws);
  console.log(`✅ User connected: ${address} (Total: ${clients.size})`);
  
  // Send current presence to new user
  const presenceList = Array.from(presence.values());
  ws.send(JSON.stringify({
    type: 'presence_sync',
    users: presenceList
  }));
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const handler = messageHandlers[message.type];
      
      if (handler) {
        handler(message, address);
      } else {
        console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Message parse error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    clients.delete(address);
    presence.delete(address);
    console.log(`❌ User disconnected: ${address} (Total: ${clients.size})`);
    
    // Notify others about disconnection
    broadcast({
      type: 'presence_update',
      user: {
        address,
        viewingProposalId: null,
        lastSeen: Date.now()
      }
    }, address);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${address}:`, error);
  });
});

/**
 * Broadcast message to all connected clients except sender
 */
function broadcast(message, senderAddress) {
  const data = JSON.stringify(message);
  let sent = 0;
  
  clients.forEach((client, address) => {
    if (address !== senderAddress && client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
        sent++;
      } catch (error) {
        console.error(`Failed to send to ${address}:`, error);
      }
    }
  });
  
  if (sent > 0) {
    console.log(`📤 Broadcasted ${message.type} to ${sent} client(s)`);
  }
}

/**
 * Broadcast message to users viewing a specific proposal
 */
function broadcastToProposal(message, proposalId, senderAddress) {
  const data = JSON.stringify(message);
  let sent = 0;
  
  presence.forEach((user, address) => {
    if (
      address !== senderAddress &&
      user.viewingProposalId === proposalId &&
      clients.has(address)
    ) {
      const client = clients.get(address);
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
          sent++;
        } catch (error) {
          console.error(`Failed to send to ${address}:`, error);
        }
      }
    }
  });
  
  if (sent > 0) {
    console.log(`📤 Sent ${message.type} to ${sent} user(s) viewing proposal ${proposalId}`);
  }
}

/**
 * Cleanup stale presence data every minute
 */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  presence.forEach((user, address) => {
    if (now - user.lastSeen > 60000) { // 1 minute timeout
      presence.delete(address);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} stale presence record(s)`);
  }
}, 60000);

/**
 * Log server stats every 5 minutes
 */
setInterval(() => {
  console.log(`📊 Stats: ${clients.size} connected, ${presence.size} active`);
}, 300000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  
  wss.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

console.log(`🚀 WebSocket server running on ws://localhost:${PORT}`);
console.log(`📝 Waiting for connections...`);
