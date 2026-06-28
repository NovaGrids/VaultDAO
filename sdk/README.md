# @vaultdao/sdk

The official TypeScript SDK for building on VaultDAO — a decentralized treasury management platform on the Stellar network using Soroban smart contracts. This SDK provides complete access to vault operations: creating vaults, managing proposals, voting, recurring payments, audit logs, and real-time event streaming.

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Authentication with Freighter](#authentication-with-freighter)
4. [Core Concepts](#core-concepts)
5. [Creating Your First Proposal](#creating-your-first-proposal)
6. [Voting and Execution](#voting-and-execution)
7. [Setting Up Recurring Payments](#setting-up-recurring-payments)
8. [Reading Audit Logs](#reading-audit-logs)
9. [Event Subscription (WebSocket)](#event-subscription-websocket)
10. [Streaming Payments](#streaming-payments)
11. [Escrow Operations](#escrow-operations)
12. [Proposal Templates](#proposal-templates)
13. [Recovery Operations](#recovery-operations)
14. [Error Handling](#error-handling)
15. [TypeScript Types Reference](#typescript-types-reference)
16. [Common Mistakes](#common-mistakes)
17. [Examples](#examples)

---

## Installation

```bash
npm install @vaultdao/sdk
```

**Requirements:**
- Node.js 18+ or modern browser
- The [Freighter wallet extension](https://www.freighter.app/) for signing transactions
- A Stellar account funded on the target network

For TypeScript projects, all types are included — no separate `@types` package needed.

---

## Quick Start

Get a working VaultDAO integration in under 5 minutes. This example connects a wallet, creates a transfer proposal, and submits it to the network.

```typescript
import {
  buildOptions,
  connectWallet,
  proposeTransfer,
  signAndSubmit,
  parseError,
  VaultError,
} from "@vaultdao/sdk";

// 1. Configure SDK with your network and contract
const opts = buildOptions("testnet", "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

// 2. Connect the user's Freighter wallet
const wallet = await connectWallet();
console.log(`Connected as: ${wallet.publicKey}`);
console.log(`Network: ${wallet.network}`);

// 3. Create a transfer proposal (10 XLM)
const txXdr = await proposeTransfer(
  wallet.publicKey,
  "GDESTINATIONADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", // XLM SAC
  BigInt(100_000_000), // 10 XLM in stroops (1 XLM = 10^7 stroops)
  "Monthly infrastructure payment",
  opts,
);

// 4. Sign with Freighter and submit
const txHash = await signAndSubmit(txXdr, opts);
console.log(`Proposal created! Tx: ${txHash}`);
```

### What Just Happened?

1. `buildOptions()` created an `SdkOptions` object with the RPC URL and network passphrase for testnet.
2. `connectWallet()` opened the Freighter popup and retrieved the user's public key and network.
3. `proposeTransfer()` built and simulated a Soroban contract call, returning an unsigned transaction XDR.
4. `signAndSubmit()` sent the XDR to Freighter for signing, then submitted the signed transaction to the Soroban RPC.

The proposal is now on-chain and waiting for other signers to approve it.

---

## Authentication with Freighter

Every write operation in VaultDAO requires a signed transaction from a wallet. The SDK handles this through the `connectWallet()` and `signAndSubmit()` functions.

### Connecting

```typescript
import { connectWallet } from "@vaultdao/sdk";

try {
  const wallet = await connectWallet();
  // wallet.publicKey  → "GABC..."
  // wallet.network    → "Test SDF Network ; September 2015"
  // wallet.networkUrl → "https://soroban-testnet.stellar.org"
} catch (err) {
  if (err.message.includes("not installed")) {
    // Freighter extension not found — show install prompt
  } else if (err.message.includes("rejected")) {
    // User declined the connection request
  }
}
```

### Network Awareness

Always verify the wallet is on the correct network before building transactions:

```typescript
import { NETWORK_PASSPHRASES } from "@vaultdao/sdk";

const wallet = await connectWallet();

if (wallet.network !== NETWORK_PASSPHRASES.testnet) {
  throw new Error(
    `Please switch Freighter to Testnet. Currently on: ${wallet.network}`
  );
}
```

### Signing Flow

The SDK separates transaction building from signing. Every mutation function returns an unsigned XDR string. You then pass it to `signAndSubmit()`:

```typescript
// Build the transaction (no signature needed)
const unsignedXdr = await proposeTransfer(publicKey, recipient, token, amount, memo, opts);

// Sign with Freighter and submit to the network
const txHash = await signAndSubmit(unsignedXdr, opts);
```

This separation allows you to:
- Inspect the transaction before signing
- Implement custom signing flows (hardware wallets, multi-party signing)
- Log or audit transactions before submission

---

## Core Concepts

### SDK Options

Every function that interacts with the Soroban contract requires an `SdkOptions` object:

```typescript
import { buildOptions } from "@vaultdao/sdk";

// Preset network (testnet, mainnet, futurenet)
const opts = buildOptions("testnet", "CCONTRACTID...");

// Custom network
const customOpts: SdkOptions = {
  contractId: "CCONTRACTID...",
  rpcUrl: "https://my-rpc.example.com",
  networkPassphrase: "My Custom Network",
};
```

### Roles

VaultDAO uses role-based access control:

```typescript
import { Role } from "@vaultdao/sdk";

Role.Member    // 0 — Read-only access
Role.Treasurer // 1 — Can create and approve proposals
Role.Admin     // 2 — Full control: roles, signers, configuration
```

### Proposal Lifecycle

```
Pending → Approved → Executed
   ↓         ↓
Expired   Rejected
```

Proposals move through these statuses:

```typescript
import { ProposalStatus } from "@vaultdao/sdk";

ProposalStatus.Pending   // 0 — Awaiting approvals
ProposalStatus.Approved  // 1 — Threshold met, ready to execute
ProposalStatus.Executed  // 2 — Funds transferred
ProposalStatus.Rejected  // 3 — Cancelled by admin or proposer
ProposalStatus.Expired   // 4 — Timed out without enough approvals
```

### Amounts and Stroops

All token amounts in the SDK use `bigint` in the token's smallest unit. For XLM, this is stroops (1 XLM = 10,000,000 stroops):

```typescript
const tenXlm = BigInt(100_000_000);     // 10 XLM
const halfXlm = BigInt(5_000_000);      // 0.5 XLM
const oneHundredXlm = BigInt(1_000_000_000); // 100 XLM
```

---

## Creating Your First Proposal

A transfer proposal requests funds to be sent from the vault to a recipient. It requires approval from enough signers before it can be executed.

### Basic Transfer Proposal

```typescript
import {
  buildOptions,
  connectWallet,
  proposeTransfer,
  signAndSubmit,
} from "@vaultdao/sdk";

const opts = buildOptions("testnet", "CCONTRACTID...");
const wallet = await connectWallet();

const txXdr = await proposeTransfer(
  wallet.publicKey,       // Proposer (must be Treasurer or Admin)
  "GRECIPIENTADDR...",    // Recipient address
  "CDLZFC3...",           // Token contract address (XLM SAC for native)
  BigInt(50_000_000),     // 5 XLM
  "Q1 marketing budget",  // Memo / description
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
console.log(`Proposal submitted: ${txHash}`);
```

### Reading Proposal Details

```typescript
import { getProposal, ProposalStatus } from "@vaultdao/sdk";

// Read-only — no wallet needed
const proposal = await getProposal(BigInt(1), "GREADERADDR...", opts);

console.log(`ID: ${proposal.id}`);
console.log(`Status: ${ProposalStatus[proposal.status]}`);
console.log(`Amount: ${proposal.amount} stroops`);
console.log(`Approvals: ${proposal.approvals.length}`);
console.log(`Expires at ledger: ${proposal.expiresAt}`);
```

### Proposal with Timelock

If the amount exceeds the vault's `timelockThreshold`, the proposal automatically enters a timelock period after approval. No extra code is needed — the contract enforces this:

```typescript
// Large transfer — will trigger timelock
const txXdr = await proposeTransfer(
  wallet.publicKey,
  "GRECIPIENT...",
  "CDLZFC3...",
  BigInt(5_000_000_000), // 500 XLM — likely above threshold
  "Major infrastructure upgrade",
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
// After approval, must wait for timelock to expire before execution
```

---

## Voting and Execution

### Approving a Proposal

Each signer reviews and approves proposals independently. The proposal becomes executable when the approval count reaches the vault's threshold.

```typescript
import {
  approveProposal,
  signAndSubmit,
} from "@vaultdao/sdk";

const wallet = await connectWallet();

// Approve proposal #1
const txXdr = await approveProposal(wallet.publicKey, BigInt(1), opts);
const txHash = await signAndSubmit(txXdr, opts);
console.log(`Approved! Tx: ${txHash}`);
```

### Rejecting a Proposal

Admins or the original proposer can reject a proposal:

```typescript
import { rejectProposal, signAndSubmit } from "@vaultdao/sdk";

const txXdr = await rejectProposal(wallet.publicKey, BigInt(1), opts);
const txHash = await signAndSubmit(txXdr, opts);
console.log(`Proposal rejected: ${txHash}`);
```

### Executing an Approved Proposal

Once the approval threshold is met and any timelock has expired, any authorized user can execute:

```typescript
import {
  getProposal,
  executeProposal,
  signAndSubmit,
  ProposalStatus,
} from "@vaultdao/sdk";
import { SorobanRpc } from "stellar-sdk";

const proposal = await getProposal(BigInt(1), wallet.publicKey, opts);

if (proposal.status !== ProposalStatus.Approved) {
  console.error("Proposal is not approved yet");
  process.exit(1);
}

// Check timelock if applicable
if (proposal.unlockLedger > BigInt(0)) {
  const server = new SorobanRpc.Server(opts.rpcUrl);
  const ledger = await server.getLatestLedger();
  if (BigInt(ledger.sequence) < proposal.unlockLedger) {
    const remaining = Number(proposal.unlockLedger - BigInt(ledger.sequence)) * 5;
    console.error(`Timelock active — ${Math.ceil(remaining / 3600)}h remaining`);
    process.exit(1);
  }
}

// Execute
const txXdr = await executeProposal(wallet.publicKey, BigInt(1), opts);
const txHash = await signAndSubmit(txXdr, opts);
console.log(`Executed! Funds transferred. Tx: ${txHash}`);
```

### Complete Voting Workflow

See [sdk/examples/vote-proposal.ts](./examples/vote-proposal.ts) for a complete example that checks proposal status, approves, and executes in sequence.

---

## Setting Up Recurring Payments

Recurring payments allow vaults to schedule automatic transfers on a fixed schedule (e.g., monthly payroll, subscription payments).

### Creating a Recurring Payment

```typescript
import {
  schedulePayment,
  signAndSubmit,
} from "@vaultdao/sdk";

const wallet = await connectWallet();

const txXdr = await schedulePayment(
  wallet.publicKey,
  "GRECIPIENT...",           // Recipient
  "CDLZFC3...",              // Token (XLM SAC)
  BigInt(10_000_000),        // 1 XLM per payment
  BigInt(30 * 24 * 60 * 12), // Interval: ~30 days in ledgers (5s/ledger)
  "Monthly contractor payment",
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
console.log(`Recurring payment scheduled: ${txHash}`);
```

### Executing a Recurring Payment

When a recurring payment interval has elapsed, trigger the next payment:

```typescript
import { executeRecurringPayment, signAndSubmit } from "@vaultdao/sdk";

const paymentId = BigInt(1);
const txXdr = await executeRecurringPayment(wallet.publicKey, paymentId, opts);
const txHash = await signAndSubmit(txXdr, opts);
console.log(`Payment executed: ${txHash}`);
```

### Complete Example

See [sdk/examples/create-recurring.ts](./examples/create-recurring.ts) for a full working example.

---

## Reading Audit Logs

The audit trail provides a complete record of all vault operations — proposals, approvals, executions, role changes, and configuration updates.

```typescript
import { getAuditTrail } from "@vaultdao/sdk";

// Fetch the full audit trail for the vault
const auditEntries = await getAuditTrail(wallet.publicKey, opts);

for (const entry of auditEntries) {
  console.log(`[${entry.timestamp}] ${entry.action} by ${entry.actor}`);
  console.log(`  Details: ${JSON.stringify(entry.details)}`);
}
```

### Filtering Audit Entries

The audit trail returns all entries. Filter client-side for specific operations:

```typescript
// Find all proposal executions
const executions = auditEntries.filter(
  (e) => e.action === "proposal_executed"
);

// Find all role changes
const roleChanges = auditEntries.filter(
  (e) => e.action === "role_changed"
);

// Find activity by a specific address
const userActivity = auditEntries.filter(
  (e) => e.actor === "GSPECIFICADDR..."
);
```

---

## Event Subscription (WebSocket)

VaultDAO's backend provides real-time event streaming over WebSocket. Subscribe to vault events to get instant updates on proposals, votes, executions, and more.

### Connecting to the Event Stream

```typescript
const ws = new WebSocket("wss://your-vaultdao-backend.example.com/ws");

ws.onopen = () => {
  console.log("Connected to VaultDAO event stream");

  // Subscribe to a specific vault's events
  ws.send(JSON.stringify({
    type: "subscribe",
    topic: "vault:CCONTRACTID...",
  }));
};

ws.onmessage = (event) => {
  const envelope = JSON.parse(event.data);

  switch (envelope.type) {
    case "proposal_created":
      console.log(`New proposal #${envelope.data.proposalId}`);
      break;
    case "proposal_approved":
      console.log(`Proposal #${envelope.data.proposalId} approved by ${envelope.data.signer}`);
      break;
    case "proposal_executed":
      console.log(`Proposal #${envelope.data.proposalId} executed!`);
      break;
    default:
      console.log(`Event: ${envelope.type}`, envelope.data);
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("Disconnected — reconnecting in 5s...");
  setTimeout(connect, 5000);
};
```

### Event Types

| Event | Description | Key Fields |
|---|---|---|
| `proposal_created` | New proposal submitted | `proposalId`, `proposer`, `amount`, `recipient` |
| `proposal_approved` | Signer approved a proposal | `proposalId`, `signer`, `approvalCount` |
| `proposal_executed` | Proposal executed, funds transferred | `proposalId`, `txHash`, `amount` |
| `proposal_rejected` | Proposal cancelled | `proposalId`, `rejectedBy` |
| `proposal_expired` | Proposal timed out | `proposalId` |
| `role_changed` | Signer role updated | `address`, `oldRole`, `newRole` |
| `signer_added` | New signer added to vault | `address` |
| `signer_removed` | Signer removed from vault | `address` |
| `recurring_executed` | Recurring payment triggered | `paymentId`, `amount`, `recipient` |
| `circuit_breaker_triggered` | RPC circuit breaker opened | `endpoint`, `reason` |

### Reconnection with Backoff

For production use, implement exponential backoff reconnection:

```typescript
function createEventStream(url: string, onEvent: (event: any) => void) {
  let reconnectDelay = 1000;
  let ws: WebSocket;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000; // Reset on successful connection
      ws.send(JSON.stringify({ type: "subscribe", topic: "vault:CCONTRACTID..." }));
    };

    ws.onmessage = (event) => {
      onEvent(JSON.parse(event.data));
    };

    ws.onclose = () => {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
  }

  connect();
  return () => ws.close();
}
```

See [sdk/examples/listen-events.ts](./examples/listen-events.ts) for a complete example.

---

## Streaming Payments

Streaming payments allow continuous, time-proportional fund transfers — useful for salaries, service fees, or vesting schedules.

### Creating a Stream

```typescript
import { createStream, signAndSubmit } from "@vaultdao/sdk";

const txXdr = await createStream(
  wallet.publicKey,
  "GRECIPIENT...",        // Stream recipient
  "CDLZFC3...",           // Token
  BigInt(100_000_000),    // Total amount: 10 XLM
  BigInt(1000),           // Duration: 1000 ledgers (~83 minutes)
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
```

### Claiming from a Stream

Recipients claim their earned amount at any time:

```typescript
import { claimStream, signAndSubmit } from "@vaultdao/sdk";

const streamId = BigInt(1);
const txXdr = await claimStream(wallet.publicKey, streamId, opts);
const txHash = await signAndSubmit(txXdr, opts);
```

### Pausing and Cancelling

```typescript
import { pauseStream, cancelStream, signAndSubmit } from "@vaultdao/sdk";

// Pause — stops accumulation, can be resumed
const pauseXdr = await pauseStream(wallet.publicKey, streamId, opts);
await signAndSubmit(pauseXdr, opts);

// Cancel — releases unclaimed funds back to vault
const cancelXdr = await cancelStream(wallet.publicKey, streamId, opts);
await signAndSubmit(cancelXdr, opts);
```

---

## Escrow Operations

Escrow allows milestone-based payments where funds are released incrementally as work is completed.

### Creating an Escrow

```typescript
import { createEscrow, signAndSubmit } from "@vaultdao/sdk";

const txXdr = await createEscrow(
  wallet.publicKey,
  "GCONTRACTOR...",      // Contractor receiving funds
  "CDLZFC3...",          // Token
  BigInt(500_000_000),   // 50 XLM total
  3,                     // 3 milestones
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
```

### Completing Milestones and Releasing Funds

```typescript
import { completeMilestone, releaseEscrow, signAndSubmit } from "@vaultdao/sdk";

// Mark milestone 1 as complete
const milestoneXdr = await completeMilestone(wallet.publicKey, escrowId, 1, opts);
await signAndSubmit(milestoneXdr, opts);

// Release funds for completed milestones
const releaseXdr = await releaseEscrow(wallet.publicKey, escrowId, opts);
await signAndSubmit(releaseXdr, opts);
```

### Disputes

```typescript
import { disputeEscrow, signAndSubmit } from "@vaultdao/sdk";

const disputeXdr = await disputeEscrow(wallet.publicKey, escrowId, "Work not delivered", opts);
await signAndSubmit(disputeXdr, opts);
```

---

## Proposal Templates

Templates allow creating reusable proposal configurations for common operations.

### Creating a Template

```typescript
import { createTemplate, signAndSubmit } from "@vaultdao/sdk";

const txXdr = await createTemplate(
  wallet.publicKey,
  "Monthly Payroll",         // Template name
  "GPAYROLLADDR...",         // Default recipient
  "CDLZFC3...",              // Token
  BigInt(100_000_000),       // Default amount: 10 XLM
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
```

### Creating a Proposal from a Template

```typescript
import { proposeFromTemplate, signAndSubmit } from "@vaultdao/sdk";

const templateId = BigInt(1);
const txXdr = await proposeFromTemplate(
  wallet.publicKey,
  templateId,
  "June payroll",  // Override memo
  opts,
);

const txHash = await signAndSubmit(txXdr, opts);
```

---

## Recovery Operations

Recovery provides an emergency mechanism to regain control of a vault if signers are unavailable.

```typescript
import {
  proposeRecovery,
  approveRecovery,
  executeRecovery,
  signAndSubmit,
} from "@vaultdao/sdk";

// 1. Propose recovery — specify new signers and threshold
const proposeXdr = await proposeRecovery(
  wallet.publicKey,
  ["GNEWSIGNER1...", "GNEWSIGNER2...", "GNEWSIGNER3..."],
  2, // New threshold
  opts,
);
const proposeTx = await signAndSubmit(proposeXdr, opts);

// 2. Approve recovery (requires existing signers or recovery guardians)
const approveXdr = await approveRecovery(wallet.publicKey, recoveryId, opts);
await signAndSubmit(approveXdr, opts);

// 3. Execute recovery after timelock
const executeXdr = await executeRecovery(wallet.publicKey, recoveryId, opts);
await signAndSubmit(executeXdr, opts);
```

---

## Error Handling

The SDK provides structured error handling through `VaultError` and `parseError()`.

### Using parseError

```typescript
import { parseError, VaultError, VaultErrorCode } from "@vaultdao/sdk";

try {
  const txXdr = await proposeTransfer(/* ... */);
  const txHash = await signAndSubmit(txXdr, opts);
} catch (err) {
  const parsed = parseError(err);

  if (parsed instanceof VaultError) {
    console.error(`Contract error: ${VaultErrorCode[parsed.code]}`);

    switch (parsed.code) {
      case VaultErrorCode.InsufficientRole:
        console.error("You don't have permission for this action");
        break;
      case VaultErrorCode.InsufficientBalance:
        console.error("Vault doesn't have enough funds");
        break;
      case VaultErrorCode.ThresholdNotMet:
        console.error("Not enough approvals yet");
        break;
      case VaultErrorCode.TimelockNotExpired:
        console.error("Timelock period hasn't ended");
        break;
      case VaultErrorCode.ProposalExpired:
        console.error("This proposal has expired");
        break;
      default:
        console.error(`Error code: ${parsed.code}`);
    }
  } else {
    // Network errors, Freighter errors, simulation failures
    console.error("Unexpected error:", parsed.message);
  }
}
```

### Error Codes Reference

| Code | Name | Meaning |
|---|---|---|
| 1 | `InsufficientRole` | Caller lacks the required role (Member/Treasurer/Admin) |
| 2 | `InsufficientBalance` | Vault token balance is too low |
| 3 | `ThresholdNotMet` | Approval count < vault threshold |
| 4 | `TimelockNotExpired` | Timelock period is still active |
| 5 | `ProposalExpired` | Proposal passed its expiry ledger |
| 6 | `SpendingLimitExceeded` | Transfer exceeds per-proposal spending limit |
| 7 | `DailyLimitExceeded` | Daily aggregate outflow limit reached |
| 8 | `WeeklyLimitExceeded` | Weekly aggregate outflow limit reached |
| 9 | `AlreadyApproved` | Signer already approved this proposal |
| 10 | `InvalidProposal` | Proposal ID does not exist |

---

## TypeScript Types Reference

All types are exported from the main entry point:

```typescript
import type {
  // Configuration
  InitConfig,        // Vault initialization parameters
  VaultConfig,       // Active vault configuration
  SdkOptions,        // RPC + contract connection options
  Network,           // "testnet" | "mainnet" | "futurenet" | "custom"

  // Core entities
  Proposal,          // Transfer proposal with full metadata
  RecurringPayment,  // Recurring payment schedule
  StreamingPayment,  // Continuous streaming payment
  Subscription,      // Subscription record
  Escrow,            // Milestone-based escrow
  ProposalTemplate,  // Reusable proposal template
  Comment,           // Proposal comment

  // Analytics
  VaultMetrics,      // Vault performance metrics
  Reputation,        // Signer reputation scores
  AuditEntry,        // Audit log entry

  // Wallet
  WalletConnection,  // Connected wallet details
} from "@vaultdao/sdk";

// Enums
import {
  Role,              // Member, Treasurer, Admin
  ProposalStatus,    // Pending, Approved, Executed, Rejected, Expired
  VaultErrorCode,    // Contract error codes
} from "@vaultdao/sdk";
```

### Key Type Details

**`Proposal`** — The core entity:
```typescript
interface Proposal {
  id: bigint;
  proposer: string;
  recipient: string;
  token: string;
  amount: bigint;        // In token's smallest unit
  memo: string;
  approvals: string[];   // Addresses that approved
  status: ProposalStatus;
  createdAt: bigint;     // Ledger number
  expiresAt: bigint;     // Ledger number
  unlockLedger: bigint;  // 0 = no timelock
}
```

**`SdkOptions`** — Required by all contract functions:
```typescript
interface SdkOptions {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}
```

---

## Common Mistakes

### Wrong Network

**Problem**: Transaction fails with a cryptic simulation error.

**Cause**: Freighter is set to Testnet but you're targeting Mainnet (or vice versa).

**Fix**: Always check the network after connecting:

```typescript
const wallet = await connectWallet();
const expected = NETWORK_PASSPHRASES.testnet;
if (wallet.network !== expected) {
  throw new Error(`Wrong network. Expected: ${expected}, got: ${wallet.network}`);
}
```

### Missing Authentication

**Problem**: `InsufficientRole` error when creating a proposal.

**Cause**: The connected address doesn't have the Treasurer or Admin role in the vault.

**Fix**: Verify the address has the correct role before attempting operations:

```typescript
import { getVaultMetrics } from "@vaultdao/sdk";

// Check vault configuration to see authorized signers
const metrics = await getVaultMetrics(wallet.publicKey, opts);
```

### Timelock Not Expired

**Problem**: `TimelockNotExpired` error when executing a proposal.

**Cause**: The proposal's `unlockLedger` hasn't been reached yet. Large transfers are time-locked for security.

**Fix**: Check `proposal.unlockLedger` against the current ledger sequence:

```typescript
import { SorobanRpc } from "stellar-sdk";

const server = new SorobanRpc.Server(opts.rpcUrl);
const ledger = await server.getLatestLedger();
const currentLedger = BigInt(ledger.sequence);

if (currentLedger < proposal.unlockLedger) {
  const remainingSeconds = Number(proposal.unlockLedger - currentLedger) * 5;
  console.log(`Wait ${Math.ceil(remainingSeconds / 60)} more minutes`);
}
```

### Using Number Instead of BigInt

**Problem**: Amounts are wrong or the SDK throws a type error.

**Cause**: Token amounts must be `bigint`, not `number`. JavaScript `number` loses precision for large Stellar amounts.

**Fix**: Always use `BigInt()` for amounts:

```typescript
// Wrong
const amount = 100_000_000;

// Correct
const amount = BigInt(100_000_000);
```

### Expired Proposal

**Problem**: `ProposalExpired` error when approving or executing.

**Cause**: Proposals expire after ~7 days (a fixed number of ledgers). If signers don't approve in time, the proposal becomes invalid.

**Fix**: Check `proposal.expiresAt` before attempting to interact:

```typescript
const proposal = await getProposal(proposalId, wallet.publicKey, opts);
const server = new SorobanRpc.Server(opts.rpcUrl);
const ledger = await server.getLatestLedger();

if (BigInt(ledger.sequence) > proposal.expiresAt) {
  console.error("This proposal has expired. Create a new one.");
}
```

### Duplicate Approval

**Problem**: `AlreadyApproved` error.

**Cause**: The connected address has already approved this proposal. Each signer can only approve once.

**Fix**: Check the proposal's `approvals` array:

```typescript
if (proposal.approvals.includes(wallet.publicKey)) {
  console.log("You already approved this proposal");
}
```

---

## Examples

Working example scripts are in the [`examples/`](./examples/) directory:

| File | Description |
|---|---|
| [`propose-transfer.ts`](./examples/propose-transfer.ts) | Create a transfer proposal |
| [`approve-proposal.ts`](./examples/approve-proposal.ts) | Approve a pending proposal |
| [`execute-proposal.ts`](./examples/execute-proposal.ts) | Execute an approved proposal |
| [`get-vault-info.ts`](./examples/get-vault-info.ts) | Read vault state (no wallet needed) |
| [`create-vault.ts`](./examples/create-vault.ts) | Initialize a new vault with signers and thresholds |
| [`vote-proposal.ts`](./examples/vote-proposal.ts) | Full voting workflow: check, approve, execute |
| [`create-recurring.ts`](./examples/create-recurring.ts) | Set up a recurring payment schedule |
| [`listen-events.ts`](./examples/listen-events.ts) | Subscribe to real-time vault events via WebSocket |

Run any example:

```bash
npx tsx examples/create-vault.ts
```

---

## API Reference

For the complete function-level API documentation, see [docs/API.md](../docs/API.md).

## License

MIT
