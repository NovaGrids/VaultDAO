/**
 * Simple WebSocket server for collaborative editing (y-websocket compatible)
 *
 * Environment variables:
 *   COLLAB_PORT  - Port to listen on (default: 1234)
 *   COLLAB_HOST  - Host to bind to (default: localhost)
 *
 * Run with: npm run collab-server
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import * as Y from 'yjs';

const PORT = process.env.COLLAB_PORT || 1234;
const HOST = process.env.COLLAB_HOST || 'localhost';

// In-memory document store: roomName -> Y.Doc
const docs = new Map();

function getDoc(roomName) {
  if (!docs.has(roomName)) {
    docs.set(roomName, new Y.Doc());
  }
  return docs.get(roomName);
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Collaborative editing WebSocket server\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const roomName = (req.url || '/').slice(1) || 'default';
  const doc = getDoc(roomName);
  const clients = new Set();

  console.log(`New connection: room="${roomName}" from ${req.socket.remoteAddress}`);
  clients.add(ws);

  // Send current document state to new client
  const state = Y.encodeStateAsUpdate(doc);
  if (state.length > 2) {
    ws.send(Buffer.concat([Buffer.from([0]), state]));
  }

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const msgType = buf[0];

    if (msgType === 0) {
      // Sync update — apply to doc and broadcast
      const update = buf.slice(1);
      Y.applyUpdate(doc, update);
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === ws.OPEN) {
          client.send(buf);
        }
      });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Connection closed: room="${roomName}"`);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error on room="${roomName}":`, err.message);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`WebSocket server running on ws://${HOST}:${PORT}`);
  console.log('Ready for collaborative editing connections');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});
