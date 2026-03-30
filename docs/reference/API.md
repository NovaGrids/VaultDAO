# VaultDAO SDK — API Reference

Complete reference for the `@vaultdao/sdk` TypeScript package.

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Contract Functions](#contract-functions)
- [Types](#types)
- [Error Codes](#error-codes)
- [Events](#events)
- [Integration Guide](#integration-guide)

---

## Installation

```bash
npm install @vaultdao/sdk
```

**Peer dependency for browser (signing):** [Freighter](https://www.freighter.app/) browser extension.

---

## Quick Start

```ts
import {
  buildOptions,
  connectWallet,
  proposeTransfer,
  signAndSubmit,
} from "@vaultdao/sdk";

const opts = buildOptions("testnet", "CXXXXXXX...");
const wallet = await connectWallet();
const txXdr = await proposeTransfer(
  wallet.publicKey,
  "GDEST...",
  "CDLZFC3...",
  BigInt(1e7),
  "memo",
  opts,
);
const hash = await signAndSubmit(txXdr, opts);
```

---

## Authentication

### `connectWallet(): Promise<WalletConnection>`

Connects to the Freighter browser extension. Throws if Freighter is not installed.

```ts
const wallet = await connectWallet();
// { publicKey: "GABC...", network: "TESTNET", networkUrl: "https://..." }
```

### `buildOptions(network, contractId): SdkOptions`

Creates the options object required by every SDK function.

| Parameter    | Type      | Description                             |
| ------------ | --------- | --------------------------------------- |
| `network`    | `Network` | `"testnet"`, `"mainnet"`, `"futurenet"` |
| `contractId` | `string`  | Deployed contract Strkey (`Cxxx...`)    |

---

## Contract Functions

All write functions return a **prepared transaction XDR string**. Pass this to `signAndSubmit()` to broadcast.

> **Stability legend**
> - 🟢 **STABLE** — Production-ready. Public API is frozen; breaking changes require a major version bump.
> - 🟡 **EXPERIMENTAL** — Maturing. Behaviour is stable but the API may change in minor versions.
> - 🔴 **UNSTABLE** — Development only. May be removed or redesigned without notice. Do not use in production.

---

### 🟢 STABLE — Core Multisig

#### `initialize(adminPublicKey, config, opts)`

🟢 **STABLE** — Core initialization (only call once).

| Parameter        | Type         | Description                              |
| ---------------- | ------------ | ---------------------------------------- |
| `adminPublicKey` | `string`     | Admin's Stellar address                  |
| `config`         | `InitConfig` | Full configuration (see [Types](#types)) |
| `opts`           | `SdkOptions` | Connection options                       |

**Errors:** `AlreadyInitialized`, `NoSigners`, `ThresholdTooLow`, `ThresholdTooHigh`, `InvalidAmount`

```ts
const txXdr = await initialize(
  adminPublicKey,
  {
    signers: [admin, signer1, signer2],
    threshold: 2,
    spendingLimit: BigInt(1000e7),
    dailyLimit: BigInt(5000e7),
    weeklyLimit: BigInt(10000e7),
    timelockThreshold: BigInt(500e7),
    timelockDelay: BigInt(17280),
  },
  opts,
);
```

#### `proposeTransfer(proposerPublicKey, recipient, tokenAddress, amount, memo, opts)`

🟢 **STABLE** — Core proposal creation.

**Errors:** `InsufficientRole`, `InvalidAmount`, `ExceedsProposalLimit`, `ExceedsDailyLimit`, `ExceedsWeeklyLimit`, `VelocityLimitExceeded`

#### `approveProposal(signerPublicKey, proposalId, opts)`

🟢 **STABLE** — Cast an approval vote.

**Errors:** `NotASigner`, `ProposalNotPending`, `AlreadyApproved`, `ProposalExpired`, `VotingDeadlinePassed`

#### `abstainProposal(signerPublicKey, proposalId, opts)`

🟢 **STABLE** — Cast an abstention (counts toward quorum, not threshold).

**Errors:** `NotASigner`, `ProposalNotPending`, `AlreadyApproved`, `ProposalExpired`

#### `executeProposal(executorPublicKey, proposalId, opts)`

🟢 **STABLE** — Execute an `Approved` proposal.

**Errors:** `ProposalNotApproved`, `ProposalAlreadyExecuted`, `TimelockNotExpired`, `InsufficientBalance`, `ProposalExpired`, `ConditionsNotMet`

#### `cancelProposal(callerPublicKey, proposalId, reason, opts)`

🟢 **STABLE** — Cancel a `Pending` proposal. Only the original proposer or an Admin may cancel.

**Errors:** `Unauthorized`, `ProposalNotPending`, `ProposalAlreadyCancelled`

---

### 🟢 STABLE — RBAC

#### `setRole(adminPublicKey, targetAddress, role, opts)`

🟢 **STABLE** — Assign a `Role` to any address. Only `Admin` can call this.

**Errors:** `Unauthorized`, `NotInitialized`

#### `getRole(address, callerKey, opts)`

🟢 **STABLE** — Read-only. Returns the `Role` for an address.

---

### 🟢 STABLE — Config Management

#### `updateThreshold(adminPublicKey, threshold, opts)`

🟢 **STABLE** — Change the M-of-N approval threshold.

**Errors:** `Unauthorized`, `ThresholdTooLow`, `ThresholdTooHigh`

#### `updateLimits(adminPublicKey, spendingLimit, dailyLimit, weeklyLimit, opts)`

🟢 **STABLE** — Update per-proposal and aggregate spending limits.

**Errors:** `Unauthorized`, `InvalidAmount`

#### `updateQuorum(adminPublicKey, quorum, opts)`

🟢 **STABLE** — Set the minimum vote participation required before threshold is checked.

**Errors:** `Unauthorized`, `QuorumTooHigh`

---

### 🟢 STABLE — Recipient Lists

#### `setListMode(adminPublicKey, mode, opts)`

🟢 **STABLE** — Set recipient filtering mode: `Disabled`, `Whitelist`, or `Blacklist`.

#### `addToWhitelist(adminPublicKey, address, opts)` / `removeFromWhitelist(...)`

🟢 **STABLE** — Manage the whitelist.

**Errors:** `Unauthorized`, `AddressAlreadyOnList`, `AddressNotOnList`

#### `addToBlacklist(adminPublicKey, address, opts)` / `removeFromBlacklist(...)`

🟢 **STABLE** — Manage the blacklist.

---

### 🟢 STABLE — Core Reads

| Function                                    | Description                        | Returns          |
| ------------------------------------------- | ---------------------------------- | ---------------- |
| `getProposal(id, callerKey, opts)`          | Fetch proposal by ID               | `Proposal`       |
| `listProposalIds(offset, limit, opts)`      | Paginated proposal ID list         | `bigint[]`       |
| `listProposals(offset, limit, opts)`        | Paginated full proposal list       | `Proposal[]`     |
| `getConfig(callerKey, opts)`                | Full vault configuration           | `Config`         |
| `getSigners(callerKey, opts)`               | Current signer set                 | `string[]`       |
| `isSigner(address, callerKey, opts)`        | Is address a signer?               | `boolean`        |
| `getRole(address, callerKey, opts)`         | Role for address                   | `Role`           |
| `getTodaySpent(callerKey, opts)`            | Today's aggregate spending         | `bigint`         |
| `getAuditEntry(id, callerKey, opts)`        | Single audit entry                 | `AuditEntry`     |
| `verifyAuditTrail(startId, endId, opts)`    | Verify hash chain integrity        | `boolean`        |

---

### 🟡 EXPERIMENTAL — Batch Operations

#### `batchProposeTransfers(proposerPublicKey, transfers, priority, opts)`

🟡 **EXPERIMENTAL** — Create multiple proposals in one call.

**Errors:** `BatchTooLarge`, `InsufficientRole`, `VelocityLimitExceeded`

#### `batchExecuteProposals(executorPublicKey, proposalIds, opts)`

🟡 **EXPERIMENTAL** — Execute multiple approved proposals. Skips failures; returns success/fail counts.

---

### 🟡 EXPERIMENTAL — Recurring Payments

#### `schedulePayment(proposerPublicKey, recipient, tokenAddress, amount, memo, intervalLedgers, opts)`

🟡 **EXPERIMENTAL** — Schedule a recurring automatic payment. Minimum interval is 720 ledgers (~1 hour).

**Errors:** `InsufficientRole`, `InvalidAmount`, `IntervalTooShort`, `RecipientNotWhitelisted`, `RecipientBlacklisted`

#### `executeRecurringPayment(paymentId, opts)`

🟡 **EXPERIMENTAL** — Execute a due recurring payment. Anyone (keeper bot) can call this.

**Errors:** `RecurringPaymentNotDue`, `ConditionsNotMet` (payment inactive), `ExceedsDailyLimit`, `InsufficientBalance`

---

### 🟡 EXPERIMENTAL — Hooks

#### `registerPreHook(adminPublicKey, hookAddress, opts)`

🟡 **EXPERIMENTAL** — Register a contract address to be called before proposal execution.

**Errors:** `Unauthorized`, `HookAlreadyRegistered`

#### `registerPostHook(adminPublicKey, hookAddress, opts)`

🟡 **EXPERIMENTAL** — Register a contract address to be called after proposal execution.

**Errors:** `Unauthorized`, `HookAlreadyRegistered`

#### `removePreHook(adminPublicKey, hookAddress, opts)` / `removePostHook(...)`

🟡 **EXPERIMENTAL** — Remove a registered hook.

**Errors:** `Unauthorized`, `HookNotFound`

---

### 🟡 EXPERIMENTAL — Veto

#### `vetoProposal(vetoerPublicKey, proposalId, opts)`

🟡 **EXPERIMENTAL** — Veto a pending or approved proposal. Only configured veto addresses may call this.

**Errors:** `NotVetoAddress`, `ProposalAlreadyExecuted`, `ProposalNotPending`

---

### 🟡 EXPERIMENTAL — Escrow

#### `createEscrow(funderPublicKey, recipient, token, amount, milestones, durationLedgers, arbitrator, opts)`

🟡 **EXPERIMENTAL** — Create a milestone-based escrow agreement.

**Errors:** `InvalidAmount`

#### `completeMilestone(completerPublicKey, escrowId, milestoneId, opts)`

🟡 **EXPERIMENTAL** — Mark a milestone as completed.

#### `releaseEscrowFunds(escrowId, opts)`

🟡 **EXPERIMENTAL** — Release funds for completed milestones or refund on expiry.

---

### 🟡 EXPERIMENTAL — Funding Rounds

#### `createFundingRound(creatorPublicKey, proposalId, recipient, milestones, opts)`

🟡 **EXPERIMENTAL** — Create a milestone-gated funding round for a proposal.

**Errors:** `FundingRoundNotConfigured`, `FundingMilestoneCountInvalid`, `ProposalNotFound`

#### `approveFundingRound(approverPublicKey, roundId, opts)`

🟡 **EXPERIMENTAL** — Activate a pending funding round (requires signer).

**Errors:** `NotASigner`, `FundingRoundNotPending`

#### `submitMilestone(submitterPublicKey, roundId, milestoneIndex, opts)`

🟡 **EXPERIMENTAL** — Submit a milestone for verification.

**Errors:** `Unauthorized`, `FundingRoundNotActive`, `FundingMilestoneIndexOutOfRange`, `FundingMilestoneInvalidState`

#### `verifyMilestone(verifierPublicKey, roundId, milestoneIndex, opts)`

🟡 **EXPERIMENTAL** — Verify a submitted milestone (requires signer).

#### `releaseRoundFunds(releaserPublicKey, roundId, milestoneIndex, opts)`

🟡 **EXPERIMENTAL** — Release funds for a verified milestone.

#### `cancelFundingRound(cancellerPublicKey, roundId, opts)`

🟡 **EXPERIMENTAL** — Cancel an active or pending funding round.

**Errors:** `Unauthorized`, `FundingRoundFinalized`

---

### 🔴 UNSTABLE — Wallet Recovery

> ⚠️ The guardian set and recovery delay are not yet audited. Do not rely on this in production.

#### `initiateRecovery(callerPublicKey, newSigners, newThreshold, opts)`

🔴 **UNSTABLE** — Propose a full signer set replacement.

**Errors:** `NoSigners`, `ThresholdTooLow`, `ThresholdTooHigh`

#### `approveRecovery(guardianPublicKey, proposalId, opts)`

🔴 **UNSTABLE** — Guardian approval for a recovery proposal.

**Errors:** `NotGuardian`, `RecoveryProposalNotPending`

#### `executeRecovery(proposalId, opts)`

🔴 **UNSTABLE** — Execute an approved recovery after the delay elapses.

**Errors:** `RecoveryProposalNotPending`, `TimelockNotExpired`

---

### 🔴 UNSTABLE — Retry Logic

#### `getRetryState(proposalId, callerKey, opts)`

🔴 **UNSTABLE** — Read the retry state for a failed proposal execution. Backoff strategy subject to change.

---

## Types

### `InitConfig`

```ts
interface InitConfig {
  signers: string[];        // List of signer addresses
  threshold: number;        // M in M-of-N
  spendingLimit: bigint;    // Max per proposal (stroops)
  dailyLimit: bigint;       // Max daily aggregate (stroops)
  weeklyLimit: bigint;      // Max weekly aggregate (stroops)
  timelockThreshold: bigint; // Amount triggering timelock (stroops)
  timelockDelay: bigint;    // Timelock duration in ledgers
}
```

### `Proposal`

```ts
interface Proposal {
  id: bigint;
  proposer: string;
  recipient: string;
  token: string;
  amount: bigint;
  memo: string;
  approvals: string[];
  status: ProposalStatus;
  createdAt: bigint;
  expiresAt: bigint;
  unlockLedger: bigint; // 0 = no timelock
}
```

### `Role` enum

| Value            | Numeric | Permissions                   |
| ---------------- | ------- | ----------------------------- |
| `Role.Member`    | `0`     | Read-only                     |
| `Role.Treasurer` | `1`     | Propose and approve transfers |
| `Role.Admin`     | `2`     | Full control                  |

### `ProposalStatus` enum

| Value                       | Numeric | Meaning                            |
| --------------------------- | ------- | ---------------------------------- |
| `ProposalStatus.Pending`    | `0`     | Awaiting approvals                 |
| `ProposalStatus.Approved`   | `1`     | Threshold met, ready to execute    |
| `ProposalStatus.Executed`   | `2`     | Funds transferred                  |
| `ProposalStatus.Rejected`   | `3`     | Cancelled by admin                 |
| `ProposalStatus.Cancelled`  | `4`     | Cancelled by proposer              |
| `ProposalStatus.Expired`    | `5`     | Expired without reaching threshold |
| `ProposalStatus.Vetoed`     | `6`     | Blocked by a veto address          |
| `ProposalStatus.Scheduled`  | `7`     | Awaiting scheduled execution time  |

---

## Error Codes

All contract errors surface as `VaultError` instances with a `.code` property matching the on-chain `u32` discriminant.

```ts
import { parseError, VaultError } from "@vaultdao/sdk";

try {
  await proposeTransfer(/* ... */);
} catch (err) {
  const parsed = parseError(err);
  if (parsed instanceof VaultError) {
    console.error(parsed.code, parsed.message);
  }
}
```

| Code | Name                        | Stability  | Description                                    |
| ---- | --------------------------- | ---------- | ---------------------------------------------- |
| 1    | `AlreadyInitialized`        | 🟢 STABLE  | Contract already initialized                   |
| 2    | `NotInitialized`            | 🟢 STABLE  | Contract not yet initialized                   |
| 3    | `NoSigners`                 | 🟢 STABLE  | Empty signers list                             |
| 4    | `ThresholdTooLow`           | 🟢 STABLE  | Threshold < 1                                  |
| 5    | `ThresholdTooHigh`          | 🟢 STABLE  | Threshold > number of signers                  |
| 6    | `QuorumTooHigh`             | 🟢 STABLE  | Quorum > number of signers                     |
| 7    | `QuorumNotReached`          | 🟢 STABLE  | Minimum vote participation not met             |
| 10   | `Unauthorized`              | 🟢 STABLE  | Caller not permitted for this action           |
| 11   | `NotASigner`                | 🟢 STABLE  | Address not in the signers list                |
| 12   | `InsufficientRole`          | 🟢 STABLE  | Role too low (Treasurer or Admin required)     |
| 13   | `VoterNotInSnapshot`        | 🟢 STABLE  | Voter not in proposal's signer snapshot        |
| 15   | `NotVetoAddress`            | 🟡 EXPERIMENTAL | Caller is not a configured veto address   |
| 20   | `ProposalNotFound`          | 🟢 STABLE  | Proposal ID does not exist                     |
| 21   | `ProposalNotPending`        | 🟢 STABLE  | Proposal not in Pending state                  |
| 22   | `ProposalNotApproved`       | 🟢 STABLE  | Proposal not in Approved state                 |
| 23   | `ProposalAlreadyExecuted`   | 🟢 STABLE  | Proposal was already executed                  |
| 24   | `ProposalExpired`           | 🟢 STABLE  | Proposal lifetime exceeded                     |
| 25   | `ProposalAlreadyCancelled`  | 🟢 STABLE  | Proposal already cancelled                     |
| 26   | `VotingDeadlinePassed`      | 🟢 STABLE  | Voting deadline exceeded                       |
| 30   | `AlreadyApproved`           | 🟢 STABLE  | Signer already voted on this proposal          |
| 40   | `InvalidAmount`             | 🟢 STABLE  | Amount is zero, negative, or invalid           |
| 41   | `ExceedsProposalLimit`      | 🟢 STABLE  | Amount > per-proposal spending limit           |
| 42   | `ExceedsDailyLimit`         | 🟢 STABLE  | Daily aggregate cap would be exceeded          |
| 43   | `ExceedsWeeklyLimit`        | 🟢 STABLE  | Weekly aggregate cap would be exceeded         |
| 50   | `VelocityLimitExceeded`     | 🟢 STABLE  | Too many proposals in the velocity window      |
| 60   | `TimelockNotExpired`        | 🟢 STABLE  | Timelock delay has not yet elapsed             |
| 61   | `SchedulingError`           | 🟡 EXPERIMENTAL | Scheduled execution time is invalid        |
| 70   | `InsufficientBalance`       | 🟢 STABLE  | Vault balance too low for this transfer        |
| 90   | `RecipientNotWhitelisted`   | 🟢 STABLE  | Recipient not on whitelist                     |
| 91   | `RecipientBlacklisted`      | 🟢 STABLE  | Recipient is on the blacklist                  |
| 92   | `AddressAlreadyOnList`      | 🟢 STABLE  | Address already on the list                    |
| 93   | `AddressNotOnList`          | 🟢 STABLE  | Address not on the list                        |
| 110  | `InsuranceInsufficient`     | 🟡 EXPERIMENTAL | Insurance amount below minimum required    |
| 130  | `BatchTooLarge`             | 🟡 EXPERIMENTAL | Batch exceeds maximum operation count      |
| 140  | `ConditionsNotMet`          | 🟡 EXPERIMENTAL | Execution conditions not satisfied         |
| 150  | `IntervalTooShort`          | 🟡 EXPERIMENTAL | Recurring interval < 720 ledgers           |
| 151  | `RecurringPaymentNotDue`    | 🟡 EXPERIMENTAL | Payment interval not yet elapsed           |
| 160  | `DexError`                  | 🟡 EXPERIMENTAL | DEX/AMM operation failed                   |
| 168  | `RetryError`                | 🔴 UNSTABLE | Max retries exceeded or backoff not elapsed   |
| 170  | `RecoveryProposalNotPending`| 🔴 UNSTABLE | Recovery proposal not in expected state       |
| 180  | `HookNotFound`              | 🟡 EXPERIMENTAL | Hook address not registered               |
| 181  | `HookAlreadyRegistered`     | 🟡 EXPERIMENTAL | Hook address already in list              |
| 230  | `AttachmentHashInvalid`     | 🟢 STABLE  | CID length outside valid range [46, 128]       |
| 231  | `TooManyAttachments`        | 🟢 STABLE  | Max attachments per proposal reached           |
| 232  | `TooManyTags`               | 🟢 STABLE  | Max tags per proposal reached                  |
| 233  | `MetadataValueInvalid`      | 🟢 STABLE  | Metadata value empty or too long               |
| 234  | `DuplicateTag`              | 🟢 STABLE  | Tag already exists on proposal                 |
| 235  | `TagNotFound`               | 🟢 STABLE  | Tag not found on proposal                      |
| 236  | `DuplicateAttachment`       | 🟢 STABLE  | Attachment CID already exists on proposal      |
| 237  | `AttachmentIndexOutOfRange` | 🟢 STABLE  | Attachment index out of range                  |

---

## Events

| Topic                              | Additional Data                        | Emitted by                             |
| ---------------------------------- | -------------------------------------- | -------------------------------------- |
| `initialized`                      | `(admin, threshold)`                   | `initialize()`                         |
| `proposal_created` + `proposalId`  | `(proposer, recipient, amount)`        | `proposeTransfer()`                    |
| `proposal_approved` + `proposalId` | `(approver, approvalCount, threshold)` | `approveProposal()`                    |
| `proposal_ready` + `proposalId`    | —                                      | `approveProposal()` (on threshold met) |
| `proposal_executed` + `proposalId` | `(executor, recipient, amount)`        | `executeProposal()`                    |
| `proposal_rejected` + `proposalId` | `rejector`                             | `cancelProposal()` (admin rejection)   |
| `proposal_cancelled` + `proposalId`| `(canceller, reason)`                  | `cancelProposal()` (proposer)          |
| `proposal_vetoed` + `proposalId`   | `vetoer`                               | `vetoProposal()`                       |
| `role_assigned`                    | `(address, roleNumeric)`               | `setRole()`                            |
| `config_updated`                   | `updaterAddress`                       | `updateLimits()`, `updateThreshold()`  |
| `hook_registered`                  | `(hook, isPre)`                        | `registerPreHook()`, `registerPostHook()` |
| `hook_removed`                     | `(hook, isPre)`                        | `removePreHook()`, `removePostHook()`  |
| `recovery_proposed`                | `(id, threshold)`                      | `initiateRecovery()`                   |
| `recovery_executed`                | `proposalId`                           | `executeRecovery()`                    |

---

## Integration Guide

### React Application

```tsx
import {
  buildOptions,
  connectWallet,
  proposeTransfer,
  signAndSubmit,
  parseError,
  VaultError,
} from "@vaultdao/sdk";
import { useState } from "react";

const opts = buildOptions("testnet", import.meta.env.VITE_CONTRACT_ID);

export function ProposeButton({ recipient, amount }: { recipient: string; amount: bigint }) {
  const [status, setStatus] = useState("");

  const handlePropose = async () => {
    try {
      const wallet = await connectWallet();
      const txXdr = await proposeTransfer(wallet.publicKey, recipient, TOKEN_ID, amount, "memo", opts);
      const hash = await signAndSubmit(txXdr, opts);
      setStatus(`Proposal submitted: ${hash}`);
    } catch (err) {
      const parsed = parseError(err);
      setStatus(parsed instanceof VaultError ? `Error: ${parsed.message}` : "Unknown error");
    }
  };

  return <button onClick={handlePropose}>Propose Transfer — {status}</button>;
}
```

### Node.js / Backend Keeper Bot

```ts
// keeper.ts — automatically execute due recurring payments
import { buildOptions, executeRecurringPayment, signAndSubmit } from "@vaultdao/sdk";
import { Keypair } from "stellar-sdk";

const opts = buildOptions("testnet", process.env.CONTRACT_ID!);
const keeper = Keypair.fromSecret(process.env.KEEPER_SECRET!);

async function runKeeper(paymentId: bigint) {
  const txXdr = await executeRecurringPayment(keeper.publicKey(), paymentId, opts);
  const { Transaction } = await import("stellar-sdk");
  const tx = new Transaction(txXdr, opts.networkPassphrase);
  tx.sign(keeper);
  const { SorobanRpc } = await import("stellar-sdk");
  const server = new SorobanRpc.Server(opts.rpcUrl);
  await server.sendTransaction(tx);
}
```

### Common Patterns

**Poll for proposal approval:**

```ts
async function waitForApproval(proposalId: bigint, callerKey: string, opts: SdkOptions) {
  while (true) {
    const proposal = await getProposal(proposalId, callerKey, opts);
    if (proposal.status !== ProposalStatus.Pending) return proposal;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
```

**Check timelock before executing:**

```ts
import { SorobanRpc } from "stellar-sdk";

async function canExecute(proposalId: bigint, callerKey: string, opts: SdkOptions) {
  const proposal = await getProposal(proposalId, callerKey, opts);
  if (proposal.status !== ProposalStatus.Approved) return false;
  if (proposal.unlockLedger === BigInt(0)) return true;
  const server = new SorobanRpc.Server(opts.rpcUrl);
  const ledger = await server.getLatestLedger();
  return BigInt(ledger.sequence) >= proposal.unlockLedger;
}
```
