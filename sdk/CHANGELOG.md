# Changelog

All notable changes to the `@vaultdao/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on history:** The SDK has never had a tagged release — `package.json` has carried
> `"version": "0.1.0"` since the initial commit. There are no npm publishes to reconstruct
> dated version entries from. This file is therefore seeded with the current state as the
> `[0.1.0]` baseline, grouped by the meaningful feature clusters visible in `git log -- sdk/`,
> with approximate dates drawn from commit timestamps. Future releases should follow the
> [Publishing Process](./CONTRIBUTING.md#publishing-process) in `sdk/CONTRIBUTING.md` and add
> a dated entry here before every `npm publish`.

---

## [Unreleased]

_Nothing yet. Add items here as PRs land, then move them to a versioned section on release._

---

## [0.1.0] - 2026-08-27

This is the first documented baseline. It captures the full API surface that has accumulated
since the initial SDK commit (2026-02-20) across six distinct feature additions described below.

### Added

#### Core proposal lifecycle (2026-02-20)

- `initialize()` — vault initialisation call builder
- `proposeTransfer()` — build an unsigned XDR for a new transfer proposal
- `approveProposal()` — build an unsigned XDR to approve a proposal
- `executeProposal()` — build an unsigned XDR to execute an approved proposal
- `rejectProposal()` — build an unsigned XDR to cancel a proposal
- `setRole()`, `addSigner()`, `removeSigner()`, `updateLimits()`, `updateThreshold()` — admin
  contract call builders
- `schedulePayment()`, `executeRecurringPayment()` — recurring payment builders
- `getProposal()`, `getRole()`, `getTodaySpent()`, `isSigner()` — read-only view helpers
- `buildOptions()` — construct an `SdkOptions` object from a named network (`"testnet"`,
  `"mainnet"`, `"futurenet"`) or a custom RPC URL and network passphrase
- `connectWallet()` — open the Freighter popup and return a `WalletConnection`
- `buildTransaction()`, `signAndSubmit()` — transaction assembly and submission helpers
- `parseError()`, `VaultError`, `VaultErrorCode` — structured contract error handling
- `NETWORK_PASSPHRASES`, `DEFAULT_RPC_URLS` — network constants
- ScVal converter utilities: `addressToScVal`, `i128ToScVal`, `u64ToScVal`, `u32ToScVal`,
  `symbolToScVal`, `decodeScVal`
- Types: `InitConfig`, `VaultConfig`, `Proposal`, `RecurringPayment`, `SdkOptions`, `Network`,
  `WalletConnection`, `Role` (enum), `ProposalStatus` (enum)

#### Expanded contract bindings (2026-04-28)

- `createStream()`, `claimStream()`, `pauseStream()`, `cancelStream()` — streaming payment
  builders
- `createSubscription()`, `renewSubscription()`, `cancelSubscription()` — subscription builders
- `createEscrow()`, `completeMilestone()`, `releaseEscrow()`, `disputeEscrow()` — escrow
  milestone builders
- `createTemplate()`, `proposeFromTemplate()`, `deactivateTemplate()` — proposal template
  builders
- `addComment()`, `editComment()`, `getComments()` — proposal comment helpers
- `proposeRecovery()`, `approveRecovery()`, `executeRecovery()` — emergency recovery builders
- `getVaultMetrics()`, `getReputation()`, `getAuditTrail()`, `getDelegationChain()` — analytics
  and audit read helpers
- Types: `StreamingPayment`, `Subscription`, `Escrow`, `ProposalTemplate`, `Comment`,
  `VaultMetrics`, `Reputation`, `AuditEntry`

#### Observability and logging (2026-07-25)

- `SdkLogger` interface — pluggable structured logger; pass via `SdkOptions.logger`
- No-op default logger so the SDK is silent unless a logger is explicitly provided
- `buildOptions()` now accepts an optional `logger` property in its options object
- All RPC call sites emit `debug`/`warn` log events through the logger

#### Mock contract and testing utilities (2026-07-25)

- `MockVaultContract` — in-memory vault implementation with the same
  role/threshold/timelock/spending-limit rules as the on-chain contract; suitable for unit tests
  without a live RPC
- `FailureInjectionConfig` — configuration interface for simulating RPC and contract failures in
  tests
- Both exported from the main entry point for consumer test suites

#### Batch orchestration (2026-07-27 – 2026-07-28)

- `BatchProposalOrchestrator` class and `createBatchOrchestrator()` factory — fluent builder for
  creating, approving, and executing multiple proposals in a single coordinated workflow
- `executeFullOrchestration()` — run the full create → approve → execute pipeline in one call
- Built-in exponential backoff retry via `RetryConfig`
- Types: `BatchTransfer`, `RetryConfig`

#### Transaction simulation and state diffing (2026-07-28)

- `simulateWithStateDiff()` / `simulate_with_state_diff()` — simulate a transaction and return a
  structured diff of every ledger entry that would change
- `extractStateDiff()` — extract a `StateDiff` from a raw simulation response
- Types: `StateDiff`, `StateChangeEntry`, `StateChangeValue`

#### Error registry (2026-07-28)

- `ERROR_REGISTRY` (also exported as `DEFAULT_ERROR_REGISTRY`) — map of every `VaultErrorCode`
  to a human-readable description and suggested remediation
- `getErrorEntry()`, `getErrorDescription()`, `getAllErrorEntries()` — convenience accessors
- Type: `ErrorRegistryEntry`

#### Cache layer (2026-07-25)

- `ContractCache` — TTL-based in-memory cache for read-only contract calls, reducing redundant
  RPC round-trips
- `getGlobalCache()`, `destroyGlobalCache()` — process-scoped singleton cache management
- Types: `CacheEntry`, `CacheStats`, `CacheMetrics`

#### Rate-limit retry (2026-08-26)

- `retryOnRateLimit()` — wraps any async call and retries on HTTP 429 responses with
  configurable backoff

#### Fee estimation (2026-08-26)

- `estimateFee()` — simulate a transaction and return the recommended fee in stroops without
  submitting

#### Real-time proposal watching (2026-08-26 – 2026-08-27)

- `watchProposal()` — poll Soroban contract events for state changes on a single proposal;
  returns an unsubscribe function
- Types: `ProposalChange`, `ProposalChangeHandler`, `ProposalEventType`
- `SdkOptions.proposalWatchIntervalMs` — optional poll interval (default: 5 000 ms)

### Changed

- `buildOptions()` extended with optional `logger` and `proposalWatchIntervalMs` fields in
  `SdkOptions` — fully backwards-compatible; existing call sites require no changes.

---

## Migration Guide

### Upgrading within 0.1.x

No breaking changes have been introduced within the `0.1.x` line. All additions are purely
additive. Existing call sites targeting the initial API continue to compile and behave identically.

---

### Future breaking changes (0.x → 1.0.0)

When the SDK reaches `1.0.0`, this section will document any breaking changes introduced during
the pre-release cycle and provide migration examples. The pattern for each entry will be:

```typescript
// Before (0.x)
const vault = oldApi(arg1, arg2);

// After (1.0.0)
const vault = newApi(arg1, arg2, requiredNewArg);
```

Until then, all APIs marked as stable in `src/index.ts` are considered the public surface.
ScVal converter utilities (`addressToScVal`, etc.) are low-level helpers and may be revised in a
minor bump with a deprecation notice first.

---

[Unreleased]: https://github.com/NovaGrids/VaultDAO/compare/sdk-v0.1.0...HEAD
[0.1.0]: https://github.com/NovaGrids/VaultDAO/commits/main/sdk
