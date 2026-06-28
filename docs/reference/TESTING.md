# Testing Guide

VaultDAO is tested across three layers: a Soroban smart contract (Rust), a React frontend (Vitest), and a Node.js backend (native `node:test`). This guide covers all three, what to mock, what kind of test to reach for, and how it all runs in CI.

As of this writing the project has **749 contract tests** (across 35 `test_*.rs` files), **571 frontend tests** (across 47 files), and **464 backend tests** (across 60 files). That's a real, substantial suite — the goal of this guide is to help you write tests that fit the existing patterns, not invent new ones.

---

## Table of Contents

1. [Philosophy & Testing Pyramid](#1-philosophy--testing-pyramid)
2. [Smart Contract Testing (Rust)](#2-smart-contract-testing-rust)
3. [Frontend Testing (Vitest)](#3-frontend-testing-vitest)
4. [Backend Testing (Node.js)](#4-backend-testing-nodejs)
5. [CI Pipeline](#5-ci-pipeline)
6. [Best Practices](#6-best-practices)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Philosophy & Testing Pyramid

- **Test behavior, not implementation.** Assert on what a function returns or what a user sees, not on internal call order.
- **Every PR keeps tests green.** CI blocks merges on any failure (see [§5](#5-ci-pipeline)).
- **Test happy paths and failure cases.** This matters most for the contract — once deployed, on-chain logic can't be silently patched.

### Recommended split

VaultDAO doesn't currently have end-to-end (e2e) tests — there's no Playwright or Cypress setup in the repo today. Given that, the realistic, evidence-based pyramid for this project is:

| Layer | Style | Approximate share | Why |
|---|---|---|---|
| Contract unit tests | Unit | ~55% of all tests | Cheapest to run (no network), and the place where bugs are most expensive (can't patch on-chain logic post-deploy) |
| Frontend component/hook tests | Unit + light integration | ~30% of all tests | `@testing-library/react` tests render real components with mocked wallet/SDK boundaries — closer to integration than pure unit, but still fast and isolated |
| Backend unit + property tests | Unit + property-based | ~10% of all tests | Pure functions (normalizers, calculators) are perfect property-test candidates |
| Backend integration tests (`supertest`) | Integration | ~5% of all tests | Spin up an in-memory Express app per test — no real server, no real network |
| End-to-end | — | **0% — not yet set up** | If/when this is added, keep it the smallest slice; e2e is the slowest and flakiest layer by nature |

This roughly mirrors the actual test counts in the repo today (749 contract / 571 frontend / 464 backend). If you're adding a new feature, default to a contract or backend **unit** test first; reach for an integration-style test only when you need to verify how multiple pieces interact (an HTTP route end-to-end, a component plus real DOM events).

---

## 2. Smart Contract Testing (Rust)

Tests live in `contracts/vault/src/test.rs` plus 34 feature-specific files (`test_attachments.rs`, `test_disputes.rs`, `test_staking.rs`, etc.) — split out so each file stays focused on one feature area.

### 2.1 Running Tests

```bash
cd contracts/vault

# Run everything
cargo test

# Run one test by name
cargo test test_multisig_approval

# Show println! output (useful for debugging)
cargo test -- --nocapture

# Run only one file's tests
cargo test --test test_disputes
```

### 2.2 Test File Structure

```rust
use super::*;
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};
```

`#[cfg(test)]` on the containing module keeps test code out of the compiled WASM binary.

### 2.3 The Test Environment

```rust
let env = Env::default();
env.mock_all_auths(); // skip cryptographic signature checks in unit tests
```

Each test gets a fresh, isolated `Env` — there's no shared state between tests, even within the same file.

### 2.4 Mocking Addresses

```rust
let admin    = Address::generate(&env);
let signer   = Address::generate(&env);
let token    = Address::generate(&env); // stand-in for a token contract address
```

### 2.5 Setup Helper — Building a Valid `InitConfig`

`InitConfig` (in `contracts/vault/src/types.rs`) has grown to 24 fields as the contract has added features (quorum, velocity limits, retry config, staking, etc.). Most test files define their own local `setup()` helper. Here's a minimal, current, compiling one:

```rust
use crate::types::{
    InitConfig, RecoveryConfig, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let admin  = Address::generate(env);
    let signer = Address::generate(env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 999_999,
        timelock_delay: 0,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 80,
    };
    client.initialize(&admin, &config);

    (client, admin, signer)
}
```

> **Note on `propose_transfer`'s signature:** it currently takes 9 arguments (`proposer, recipient, token_addr, amount, memo, priority, conditions, condition_logic, insurance_amount`) plus `env`. If you're writing a new test and your call doesn't compile, check the current signature in `lib.rs` rather than copying an older example — this function has changed shape several times as features were added.

### 2.6 Testing Multi-Sig Approval

```rust
#[test]
fn test_multisig_approval() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer) = setup(&env);
    let token = Address::generate(&env);

    let proposal_id = client.propose_transfer(
        &admin,
        &signer,
        &token,
        &100i128,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&admin, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved); // threshold is 1, so one approval is enough here
}
```

### 2.7 Testing RBAC and Error Cases

Use the `try_*` variant of any contract method to capture a `Result` instead of panicking:

```rust
#[test]
fn test_unauthorized_role_change() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _signer) = setup(&env);

    let stranger = Address::generate(&env);
    let target   = Address::generate(&env);

    let result = client.try_set_role(&stranger, &target, &Role::Treasurer);
    assert_eq!(result, Err(Ok(VaultError::InsufficientRole)));
}
```

### 2.8 Testing Storage Patterns

Contract state lives behind the `storage` module (see `contracts/vault/src/storage.rs`), not as raw `env.storage()` calls scattered through `lib.rs`. When you write a test that should change persisted state, assert on the **getter**, not on internal storage keys:

```rust
#[test]
fn test_role_assignment_persists() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer) = setup(&env);

    client.set_role(&admin, &signer, &Role::Treasurer);

    // Re-fetch through the public getter — this is what storage.rs wraps
    assert_eq!(client.get_role(&signer), Role::Treasurer);
}
```

### 2.9 Testing Events

Soroban's test `Env` records every event a contract emits. Use `env.events().all()` to assert on them:

```rust
#[test]
fn test_role_change_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer) = setup(&env);

    client.set_role(&admin, &signer, &Role::Treasurer);

    let events = env.events().all();
    assert!(!events.is_empty(), "expected at least one event to be emitted");
    // events.last() gives you (contract_id, topics, data) — inspect topics/data
    // for the specific event shape your function emits (see events.rs for emit_* helpers)
}
```

For finer-grained assertions, match on the specific topic `Symbol` your function emits — check the relevant `emit_*` function in `contracts/vault/src/events.rs` for the exact topic name and data shape before asserting on it, since these are easy to get subtly wrong from memory.

### 2.10 Budget Assertions

Soroban tracks CPU instructions and memory as a "budget" per invocation — this matters because contracts that exceed network limits fail at runtime even if the logic is correct. **This pattern isn't used anywhere in VaultDAO's test suite yet** (the only existing budget-related call is `env.budget().reset_unlimited()` in `test_balance_snapshot.rs`, which *disables* the limit for a stress test rather than asserting on it) — but it's worth adopting for functions that loop over unbounded collections (attachments, approvals, signer lists):

```rust
#[test]
fn test_propose_transfer_stays_within_budget() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer) = setup(&env);
    let token = Address::generate(&env);

    env.budget().reset_default(); // start measuring from a clean slate

    client.propose_transfer(
        &admin, &signer, &token, &100i128, &Symbol::new(&env, "pay"),
        &Priority::Normal, &Vec::new(&env), &ConditionLogic::And, &0i128,
    );

    // Print actual CPU instruction / memory usage to stdout (run with --nocapture to see it)
    env.budget().print();

    // Or assert a hard ceiling so a future change can't silently regress performance:
    assert!(
        env.budget().cpu_instruction_cost() < 10_000_000,
        "propose_transfer exceeded expected CPU budget"
    );
}
```

This codebase's only existing budget-related call, `env.budget().reset_unlimited()` in `test_balance_snapshot.rs`, uses the *opposite* of this pattern — it lifts the limit entirely so a stress test with many iterations doesn't fail on resource exhaustion. Use `reset_unlimited()` when you're deliberately testing a large loop and don't care about cost; use `reset_default()` + an assertion when you want to guard against a future regression.

If you add this pattern to a new test file, mention it in your PR description — it's new to the project, so reviewers should know to expect it.

## 3. Frontend Testing (Vitest)

The frontend has 47 existing test files (571 tests) using Vitest + `@testing-library/react`. Test files live next to what they test, inside a `__tests__/` folder: `src/components/__tests__/ProposalCard.test.tsx`, `src/hooks/__tests__/useVaultContract.test.ts`.

### 3.1 Configuration (already set up)

`frontend/vitest.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    execArgv: ['--experimental-require-module'],
  },
});
```

The `execArgv` flag is there because the setup file uses `require()` inside an async `vi.mock` factory (see below) — without it, Node throws on the `require` call inside that ESM context.

### 3.2 The Setup File (already set up)

`frontend/src/test/setup.ts` does three things for every test in the suite, automatically:

```ts
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 1. Mock env config so tests don't need real VITE_ env vars
vi.mock('../config/env', () => ({
  env: {
    contractId: 'CTEST000000000000000000000000000000000000000000000000000000000',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    stellarNetwork: 'TESTNET',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
  },
}));

// 2. Stub i18next so components calling useTranslation() don't throw
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// 3. Stub react-router-dom Link / useNavigate used in dashboard pages
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => {
      const React = require('react');
      return React.createElement('a', { href: to }, children);
    },
    useNavigate: () => vi.fn(),
  };
});
```

Because these mocks are global, **you usually don't need to mock env config, i18n, or routing yourself** — they're already handled. Only add a `vi.mock(...)` in your own test file for something specific to that test (the wallet, the contract SDK, `fetch`).

### 3.3 Basic Component Test

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProposalCard from '../ProposalCard';
import type { Proposal } from '../type';

describe('ProposalCard', () => {
  const mockProposal: Proposal = {
    id: 123,
    proposer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQR',
    recipient: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNO',
    amount: '1000000000',
    status: 'Pending',
    description: 'This is a test proposal for funding development',
    createdAt: 1234567890,
    unlockTime: 1234567900,
  };

  it('renders proposal content correctly', () => {
    render(<ProposalCard proposal={mockProposal} />);
    expect(screen.getByText('Proposal #123')).toBeInTheDocument();
  });

  it('has an accessible aria-label with id and status', () => {
    render(<ProposalCard proposal={mockProposal} />);
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'Proposal #123, status: Pending');
  });
});
```

Prefer `getByRole` / `getByText` over `getByTestId` where possible — querying by role mirrors how a screen reader or real user finds the element, and catches accessibility regressions for free.

### 3.4 What to Mock: Wallet and Contract Calls

Never let a test touch a real wallet extension or a real Soroban RPC endpoint. The established pattern (see `useVaultContract.test.ts`) mocks both `useWallet` and the `stellar-sdk` package at the top of the file:

```ts
import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { useVaultContract } from '../useVaultContract';
import { useWallet } from '../useWallet';
import { SorobanRpc, nativeToScVal } from 'stellar-sdk';

vi.mock('../useWallet', () => ({ useWallet: vi.fn() }));

vi.mock('stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stellar-sdk')>();
  const mockServerInstance = {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
  };
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockImplementation(() => mockServerInstance),
    },
  };
});

global.fetch = vi.fn();

describe('useVaultContract', () => {
  const mockAddressStr = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

  beforeEach(() => {
    vi.clearAllMocks();
    (useWallet as Mock).mockReturnValue({
      isConnected: true,
      address: mockAddressStr,
      network: 'TESTNET',
      signTransaction: vi.fn(),
    });
  });

  it('fetches and formats dashboard stats correctly', async () => {
    const MockServer = vi.mocked(SorobanRpc.Server);
    const { result } = renderHook(() => useVaultContract());
    const serverMock = MockServer.mock.results[0].value;

    serverMock.getAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '1234.5678' }],
    });
    serverMock.simulateTransaction.mockResolvedValue({
      result: { retval: nativeToScVal({ signers: [mockAddressStr], threshold: 2 }) },
    });

    const stats = await result.current.getDashboardStats();
    expect(stats.totalBalance).toBe('1,234.568');
    expect(stats.threshold).toBe('2/1');
  });
});
```

Key things to notice: the mock factory rebuilds `SorobanRpc.Server` as a `vi.fn()` so each call to `new SorobanRpc.Server(...)` returns the same controllable mock instance, and `global.fetch` is stubbed at module scope so no test makes a real network call.

### 3.5 Snapshot Testing — Avoid It Here

There are currently **zero snapshot tests** in this codebase, and that's intentional — keep it that way. `toMatchSnapshot()` feels convenient but causes real problems on a project like this:

- A snapshot of a `ProposalCard` will change every time you tweak a class name or add a `data-` attribute, even when behavior hasn't changed — so snapshots get reflexively re-approved (`--update`) without anyone actually reading the diff.
- They don't express *intent*. A test asserting `expect(article).toHaveAttribute('aria-label', 'Proposal #123, status: Pending')` tells you what should be true. A snapshot tells you what *was* true at commit time, with no signal about why.
- For a contract-heavy app like this one, the values that actually matter (formatted balances, role checks, proposal status transitions) are exactly the kind of thing `toHaveTextContent` / `toHaveAttribute` express far more precisely than a full-tree snapshot.

If you're tempted to reach for a snapshot because asserting on every field individually feels tedious, that's usually a sign the component needs a smaller, more focused test rather than a snapshot of everything at once.

### 3.6 Test Naming Conventions

```tsx
describe('useVaultContract', () => {
  describe('getDashboardStats', () => {
    it('fetches and formats dashboard stats correctly', () => {});
    it('returns zero balance when account has no funded trustlines', () => {});
  });
});
```

Nest `describe` blocks by component/hook, then by method/behavior. Each `it(...)` description should read as a complete sentence when appended to "it" — `it('disables submit when amount is zero')`, not `it('amount zero test')`.

### 3.7 Running Tests

```bash
cd frontend

# Single run (this is what `npm test` does — it does NOT watch)
npm test

# Watch mode, for active development
npm run test:watch

# Single run with coverage
npm run test:coverage
```
## 4. Backend Testing (Node.js)

The backend has 60 test files (464 tests). It uses Node's **native test runner** (`node --test`), not Jest or Mocha — there's no test framework dependency to install. Assertions use `node:assert/strict`.

### 4.1 Running Tests

```bash
cd backend
npm test
```

This runs `node --import tsx --test --test-timeout=30000` against every `*.test.ts` file found under `src/`. `tsx` lets Node run TypeScript directly, no separate build step needed.

To run a single file:

```bash
node --import tsx --test src/modules/jobs/jobs.routes.test.ts
```

CI copies `backend/.env.example` to `backend/.env` before running tests — if a test reads `process.env.SOMETHING` and fails locally, check that variable is defined in `.env.example` first.

### 4.2 Anatomy of a Backend Unit Test

```ts
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { JobManager } from './job.manager.js';

describe('JobManager', () => {
  test('registers a job and lists it', () => {
    const manager = new JobManager();
    manager.registerJob({
      name: 'my-job',
      start: async () => {},
      stop: async () => {},
      isRunning: () => false,
    });

    const jobs = manager.listJobs();
    assert.ok(jobs.some((j) => j.name === 'my-job'));
  });
});
```

Note the `.js` extension on a relative import to a `.ts` file (`./job.manager.js`) — this project's `tsconfig` uses ESM-style imports, where the import specifier matches the *compiled output* extension, not the source extension. This trips people up coming from CommonJS or other TS setups.

### 4.3 Property-Based Testing with `fast-check`

Property-based tests don't assert on one example — they assert an invariant holds across hundreds of randomly generated inputs, which catches edge cases example-based tests miss entirely. The project's real, working example is `backend/src/modules/events/normalizers/normalizer.property.test.ts`, which tests `EventNormalizer.normalize()`. Here's a trimmed but complete, runnable version of its approach:

```ts
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as fc from 'fast-check';
import type { ContractEvent } from '../events.types.js';
import { EventNormalizer } from './index.js';
import { EventType, CONTRACT_EVENT_MAP } from '../types.js';

describe('EventNormalizer Property-Based Tests', () => {
  const idArb = fc.string({ minLength: 1 });
  const ledgerClosedAtArb = fc
    .integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 .. 2030-01-01
    .map((t) => new Date(t).toISOString());

  // Any structurally valid event, with a fully random topic/value shape
  const universalEventArb: fc.Arbitrary<ContractEvent> = fc.record({
    id: idArb,
    contractId: fc.string({ minLength: 1 }),
    topic: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
    value: fc.anything(),
    ledger: fc.nat(),
    ledgerClosedAt: ledgerClosedAtArb,
  });

  const knownTopicsList = Object.keys(CONTRACT_EVENT_MAP);

  // An event whose topic is guaranteed to be one the normalizer recognizes
  const knownTopicEventArb: fc.Arbitrary<ContractEvent> = fc.record({
    id: idArb,
    contractId: fc.string({ minLength: 1 }),
    topic: fc.tuple(fc.constantFrom(...knownTopicsList), fc.string({ minLength: 1 })),
    value: fc.array(fc.string({ minLength: 1 }), { minLength: 10, maxLength: 15 }),
    ledger: fc.nat(),
    ledgerClosedAt: ledgerClosedAtArb,
  });

  // PROPERTY: normalize() must never throw, for any structurally valid input
  test('Property: No-Throw Guarantee', () => {
    fc.assert(
      fc.property(universalEventArb, (event) => {
        assert.doesNotThrow(() => EventNormalizer.normalize(event));
      }),
      { numRuns: 100 },
    );
  });

  // PROPERTY: a known topic must never classify as UNKNOWN
  test('Property: Deterministic Classification (Known Topics)', () => {
    fc.assert(
      fc.property(knownTopicEventArb, (event) => {
        const res = EventNormalizer.normalize(event);
        assert.notStrictEqual(res.type, EventType.UNKNOWN);
        assert.ok(Object.values(EventType).includes(res.type));
      }),
      { numRuns: 100 },
    );
  });

  // PROPERTY: the normalized output must always preserve the original event's identity
  test('Property: Identity Integrity', () => {
    fc.assert(
      fc.property(universalEventArb, (event) => {
        const res = EventNormalizer.normalize(event);
        assert.strictEqual(res.metadata.id, event.id);
      }),
      { numRuns: 100 },
    );
  });
});
```

A few things worth calling out about why this is a *good* property test, not just "generate a random number":

- `fc.constantFrom(...knownTopicsList)` constrains the generator to only pick topics the system actually recognizes, so the "known topic" property is tested against real, valid inputs rather than mostly-garbage data that would trivially satisfy the property by accident.
- `fc.anything()` for the `value` field deliberately throws unstructured, adversarial data at the normalizer — strings, numbers, nested objects, `null`, `undefined` — to assert the no-throw guarantee under genuinely hostile input, not just "happy path" objects.
- The real file also silences `console.error`/`console.warn` around each `fc.assert` call (with restore in a `finally`), since `fast-check` deliberately generates malformed input that's *expected* to log parsing warnings — without silencing, 100 runs × several properties produces enormous, useless test output.

Start by writing 1-2 properties for any pure function that transforms data (parsers, normalizers, calculators) — anything where you can state an invariant ("the output always has field X", "this never throws", "round-tripping A→B→A returns the original").

### 4.4 Integration Testing with `supertest`

For testing HTTP routes, build the Express app in-memory per test — no real server, no real port, no real network call. The project's real pattern, from `backend/src/modules/jobs/jobs.routes.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { JobManager } from './job.manager.js';
import { createJobsRouter } from './jobs.routes.js';

function makeApp(jobManager: JobManager) {
  const app = express();
  app.use(express.json());
  const noAuth = (_req: any, _res: any, next: any) => next(); // skip auth in tests
  app.use('/api/v1/jobs', createJobsRouter(jobManager, noAuth));
  return app;
}

test('GET /api/v1/jobs: lists registered jobs', async () => {
  const manager = new JobManager();
  manager.registerJob({
    name: 'my-job',
    start: async () => {},
    stop: async () => {},
    isRunning: () => false,
  });

  const app = makeApp(manager);
  const res = await request(app).get('/api/v1/jobs').expect(200);

  const names = res.body.data.map((j: any) => j.name);
  assert.ok(names.includes('my-job'));
});

test('POST /api/v1/jobs/:name/trigger: returns 404 for unknown job', async () => {
  const app = makeApp(new JobManager());
  await request(app).post('/api/v1/jobs/nonexistent/trigger').expect(404);
});
```

Building the app fresh in each test (rather than a shared module-level instance) keeps tests isolated — one test's registered job can't leak into another's assertions.

### 4.5 Mocking the Stellar SDK

The backend depends on `stellar-sdk` for RPC/horizon access. Don't let backend tests hit a real Soroban RPC or Horizon endpoint — mock at the module boundary the same way the frontend does:

```ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Stub the specific client method your code under test calls
const mockServer = {
  getLatestLedger: async () => ({ sequence: 100 }),
  getTransaction: mock.fn(async () => ({ status: 'SUCCESS' })),
};

test('processes a transaction once it succeeds', async () => {
  const result = await mockServer.getTransaction('some-hash');
  assert.equal(result.status, 'SUCCESS');
  assert.equal(mockServer.getTransaction.mock.calls.length, 1);
});
```

Node's built-in `mock` module (`node:test`'s `mock.fn()`) is usually enough — reach for a separate mocking library only if you need something it doesn't support (partial module mocking is more limited than Vitest's `vi.mock`).
## 5. CI Pipeline

Every push to `main`, `feature/**`, or `fix/**`, and every PR targeting `main`, triggers the **CI** workflow (`.github/workflows/test.yml`). It currently runs two jobs:

| Job (internal id) | Display name | What it does |
|---|---|---|
| `contract-tests` | Smart Contract Tests | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, then builds the release WASM |
| `backend-checks` | Backend Checks | Installs deps, copies `.env.example` → `.env`, `npm run backend:typecheck`, `npm run backend:test` |

**There is currently no frontend job in CI.** Frontend tests exist (47 files, 571 tests) and can be run locally with `npm test`, but nothing runs them automatically on push or PR today. If you're adding frontend tests as part of a feature PR, your tests will pass locally but **CI will not catch a frontend regression** until a `test-frontend` job is added.

### 5.1 The Real Workflow

```yaml
name: CI

on:
  push:
    branches: [main, "feature/**", "fix/**"]
  pull_request:
    branches: [main]

jobs:
  contract-tests:
    name: Smart Contract Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: contracts/vault
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - name: Cache Cargo registry
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            contracts/vault/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('contracts/vault/Cargo.lock') }}
          restore-keys: ${{ runner.os }}-cargo-
      - name: Check formatting
        run: cargo fmt --all -- --check
      - name: Lint (clippy)
        run: cargo clippy --all-targets --all-features -- -D warnings
      - name: Run tests
        run: cargo test
      - name: Build WASM
        run: cargo build --target wasm32-unknown-unknown --release

  backend-checks:
    name: Backend Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: backend/package-lock.json
      - name: Install root dependencies
        run: npm install
      - name: Install backend dependencies
        run: npm --prefix backend install
      - name: Copy backend env
        run: cp backend/.env.example backend/.env
      - name: Typecheck backend
        run: npm run backend:typecheck
      - name: Test backend
        run: npm run backend:test
```

### 5.2 Running the Same Checks Locally Before You Push

```bash
# Smart contract — exactly what contract-tests runs
cd contracts/vault
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo build --target wasm32-unknown-unknown --release

# Backend — exactly what backend-checks runs
cp backend/.env.example backend/.env
npm run backend:typecheck
npm run backend:test

# Frontend — not yet in CI, but run it anyway before opening a PR
cd frontend
npm run typecheck
npm test
```

### 5.3 Adding a Frontend Job (proposed, not yet merged)

If you're picking up the gap above, this job follows the same shape as `backend-checks` and would slot in as a third job in `test.yml`:

```yaml
  frontend-checks:
    name: Frontend Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json
      - name: Install frontend dependencies
        run: npm --prefix frontend install
      - name: Typecheck frontend
        run: npm run typecheck
        working-directory: frontend
      - name: Run frontend tests
        run: npm test
        working-directory: frontend
```

This is a proposal, not something currently in `test.yml` — if you add it, double check the Node version matches what `backend-checks` uses (`20`) unless you have a specific reason to diverge.

---

## 6. Best Practices

### Naming Conventions

```rust
// Rust: test_<what>_<condition>_<expected>
#[test] fn test_approve_proposal_below_threshold_stays_pending() {}
#[test] fn test_approve_proposal_meets_threshold_becomes_approved() {}
```

```ts
// TypeScript: describe/it should read as a sentence
describe('approveProposal', () => {
  it('keeps status Pending when below threshold', () => {});
  it('changes status to Approved when threshold is met', () => {});
});
```

### Arrange-Act-Assert

```rust
#[test]
fn test_unauthorized_role_change() {
    // Arrange
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _signer) = setup(&env);
    let stranger = Address::generate(&env);
    let target = Address::generate(&env);

    // Act
    let result = client.try_set_role(&stranger, &target, &Role::Treasurer);

    // Assert
    assert_eq!(result, Err(Ok(VaultError::InsufficientRole)));
}
```

### DRY Setup

Extract shared initialization into a `setup()` helper (§2.5) rather than copy-pasting `InitConfig` construction into every test — with 24 fields, a copy-paste error is easy to introduce and hard to spot in review.

### Test Edge Cases

- Zero amounts, and values exactly at a threshold (not one above or below it)
- Empty signers list, empty attachments list
- Calling a function before `initialize`
- Duplicate approvals from the same signer
- For property tests: deliberately adversarial input (`fc.anything()`, malformed strings) — not just well-formed examples

### Avoid Flaky Tests

- Rust: never rely on wall-clock time — use `env.ledger().set_sequence_number(...)` to control ledger progression deterministically.
- Frontend: mock the wallet and `stellar-sdk` in every test that touches `useVaultContract` or similar hooks — never let a test attempt a real RPC call.
- Backend: build a fresh `JobManager`/Express app per test rather than sharing one across tests in a file — shared mutable state between tests is the single most common source of "passes alone, fails in the full suite."

---

## 7. Troubleshooting

### `cargo test` fails with a duplicate-field or "not enough fields" error on `InitConfig`

`InitConfig` (in `types.rs`) has 24 fields and has changed shape multiple times as features were added. If you're copying an `InitConfig` literal from an older test or an older version of this doc, check the current struct definition in `types.rs` rather than trusting an existing example — field sets here have drifted in the past.

### `env.mock_all_auths()` still requires auth

For nested authorization calls, you may need:

```rust
env.mock_all_auths_allowing_non_root_auth();
```

### Vitest — "Cannot find module '@testing-library/jest-dom'"

```bash
cd frontend
npm install -D @testing-library/jest-dom
```

Confirm `setupFiles: ['./src/test/setup.ts']` is present in `vitest.config.ts` and that the setup file imports it.

### Vitest — `require is not defined` or similar inside a `vi.mock` factory

Check that `execArgv: ['--experimental-require-module']` is still present in `vitest.config.ts` — the `react-router-dom` mock in `setup.ts` uses `require('react')` inside an async factory, which needs this flag.

### `npm test` in frontend doesn't watch for changes

That's expected — `npm test` runs `vitest --run` (single pass, CI-style). Use `npm run test:watch` for interactive development.

### Backend — `Cannot find module './foo.js'` for a file that's actually `foo.ts`

This project uses ESM-style imports where the specifier matches the compiled `.js` output extension, not the TypeScript source extension. Import `'./foo.js'` even though the file on disk is `foo.ts` — `tsx` resolves this correctly at runtime.

### Backend — a test passes alone but fails in the full suite run

Almost always shared mutable state — a module-level singleton, a shared `JobManager`, or a registered job that never got `.stop()`'d in a previous test. Build fresh instances inside each `test(...)` block, and call any `.stop()`/cleanup methods at the end of tests that start background timers.

### Tests pass locally but fail in CI

For the backend, confirm the variable you're relying on actually exists in `backend/.env.example` — CI copies that file to `.env` and nothing else. For the frontend, remember CI doesn't currently run frontend tests at all (§5), so a frontend-only failure won't show up in CI either way — catch it locally before merging.

---

## Additional Resources

- [Soroban Testing Docs](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)
- [soroban-sdk testutils](https://docs.rs/soroban-sdk/latest/soroban_sdk/testutils/index.html)
- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [fast-check Documentation](https://fast-check.dev/)
- [supertest](https://github.com/ladjs/supertest)
- [Node.js test runner docs](https://nodejs.org/api/test.html)
