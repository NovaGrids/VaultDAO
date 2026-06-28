/**
 * Example: Listen to Real-Time Vault Events
 *
 * Demonstrates how to connect to VaultDAO's WebSocket event stream
 * and react to vault events in real time.
 *
 * Prerequisites:
 *   - VaultDAO backend running with WebSocket support
 *   - npm install @vaultdao/sdk ws
 *
 * Usage:
 *   npx tsx examples/listen-events.ts
 */

import WebSocket from "ws";

const BACKEND_WS_URL = "wss://your-vaultdao-backend.example.com/ws";
const VAULT_CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  console.log(`Connecting to ${BACKEND_WS_URL}...`);
  const ws = new WebSocket(BACKEND_WS_URL);

  ws.on("open", () => {
    console.log("Connected to VaultDAO event stream");
    reconnectDelay = 1000;

    // Subscribe to vault events
    ws.send(
      JSON.stringify({
        type: "subscribe",
        topic: `vault:${VAULT_CONTRACT_ID}`,
      }),
    );
    console.log(`Subscribed to vault: ${VAULT_CONTRACT_ID}`);
    console.log("Listening for events...\n");
  });

  ws.on("message", (data: WebSocket.Data) => {
    const envelope = JSON.parse(data.toString());
    const timestamp = new Date().toISOString();

    switch (envelope.type) {
      case "proposal_created":
        console.log(`[${timestamp}] NEW PROPOSAL #${envelope.data.proposalId}`);
        console.log(`  Proposer:  ${envelope.data.proposer}`);
        console.log(`  Recipient: ${envelope.data.recipient}`);
        console.log(`  Amount:    ${envelope.data.amount} stroops`);
        console.log(`  Memo:      ${envelope.data.memo}`);
        break;

      case "proposal_approved":
        console.log(`[${timestamp}] APPROVAL on Proposal #${envelope.data.proposalId}`);
        console.log(`  Signer:    ${envelope.data.signer}`);
        console.log(`  Total:     ${envelope.data.approvalCount} approvals`);
        break;

      case "proposal_executed":
        console.log(`[${timestamp}] EXECUTED Proposal #${envelope.data.proposalId}`);
        console.log(`  Tx hash:   ${envelope.data.txHash}`);
        console.log(`  Amount:    ${envelope.data.amount} stroops`);
        break;

      case "proposal_rejected":
        console.log(`[${timestamp}] REJECTED Proposal #${envelope.data.proposalId}`);
        console.log(`  By:        ${envelope.data.rejectedBy}`);
        break;

      case "proposal_expired":
        console.log(`[${timestamp}] EXPIRED Proposal #${envelope.data.proposalId}`);
        break;

      case "role_changed":
        console.log(`[${timestamp}] ROLE CHANGE`);
        console.log(`  Address:   ${envelope.data.address}`);
        console.log(`  From:      ${envelope.data.oldRole} → ${envelope.data.newRole}`);
        break;

      case "signer_added":
        console.log(`[${timestamp}] SIGNER ADDED: ${envelope.data.address}`);
        break;

      case "signer_removed":
        console.log(`[${timestamp}] SIGNER REMOVED: ${envelope.data.address}`);
        break;

      case "recurring_executed":
        console.log(`[${timestamp}] RECURRING PAYMENT #${envelope.data.paymentId}`);
        console.log(`  Amount:    ${envelope.data.amount} stroops`);
        console.log(`  Recipient: ${envelope.data.recipient}`);
        break;

      case "circuit_breaker_triggered":
        console.log(`[${timestamp}] CIRCUIT BREAKER TRIGGERED`);
        console.log(`  Endpoint:  ${envelope.data.endpoint}`);
        console.log(`  Reason:    ${envelope.data.reason}`);
        break;

      case "heartbeat":
        // Ignore heartbeats in console output
        break;

      default:
        console.log(`[${timestamp}] ${envelope.type}:`, JSON.stringify(envelope.data, null, 2));
    }
  });

  ws.on("error", (error: Error) => {
    console.error(`WebSocket error: ${error.message}`);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.log(`\nDisconnected (code: ${code}, reason: ${reason.toString() || "none"})`);
    console.log(`Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    ws.close();
    process.exit(0);
  });
}

connect();
