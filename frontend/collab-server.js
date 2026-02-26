/**
 * Simple WebSocket server for collaborative editing
 * Run with: node collab-server.js
 */

const WebSocket = require('ws');
const http = require('http');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = process.env.COLLAB_PORT || 1234;
const HOST = process.env.COLLAB_HOST || 'localhost';

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Collaborative editing WebSocket server\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log(`New connection from ${req.socket.remoteAddress}`);
  setupWSConnection(ws, req);
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
