# Contributing to @vaultdao/sdk

This guide covers SDK-specific contribution workflow: local setup, running tests, adding a new
contract binding, versioning, and publishing. For repository-wide guidelines (code of conduct,
issue/PR process, commit message conventions), see the root [CONTRIBUTING.md](../CONTRIBUTING.md).

## Table of Contents

1. [Local Setup](#local-setup)
2. [Running Tests](#running-tests)
3. [Adding a New Contract Binding](#adding-a-new-contract-binding)
4. [Versioning Policy](#versioning-policy)
5. [Publishing Process](#publishing-process)
6. [Code Style](#code-style)

---

## Local Setup

### Prerequisites

- **Node.js** 18+ (see root [CONTRIBUTING.md](../CONTRIBUTING.md#prerequisites))
- **Stellar CLI** — only needed if you're regenerating contract bindings (see
  [Adding a New Contract Binding](#adding-a-new-contract-binding)):
  [Installation Guide](https://developers.stellar.org/docs/tools/developer-tools)

### Install and build

```bash
cd sdk
npm install
npm run build
```

`npm run build` compiles `src/**/*.ts` to `dist/` via `tsc` (see `sdk/tsconfig.json`). Build output
is git-ignored — never commit `dist/`.

### Project layout

```
sdk/
├── src/
│   ├── index.ts           # Public API surface — everything exported from @vaultdao/sdk
│   ├── contract.ts        # Contract call builders (proposeTransfer, approveProposal, etc.)
│   ├── mock-contract.ts   # In-memory mock of the vault contract, used by tests and local dev
│   ├── mock-contract.test.ts
│   ├── types.ts           # Shared TypeScript types (Proposal, SdkOptions, Role, ...)
│   ├── utils.ts           # Wallet connection, signing, error parsing helpers
│   └── bindings/          # Generated Soroban client bindings (see below) — do not hand-edit
├── examples/               # Runnable example scripts, referenced from README.md
├── package.json
└── tsconfig.json
```

Anything intended for SDK consumers must be re-exported from `src/index.ts` — files not reachable
from that entry point aren't part of the public API, even if they're exported from their own module.

---

## Running Tests

Tests use [Vitest](https://vitest.dev/) and live alongside the code they test (`*.test.ts`).

```bash
cd sdk
npm test          # run once
npm run test:watch  # re-run on file changes
```

### Writing tests

- Test business logic against `MockVaultContract` (`src/mock-contract.ts`), not against a live
  Soroban RPC endpoint — it implements the same role/threshold/timelock/spending-limit rules as
  the on-chain contract, is deterministic, and lets you advance ledger time to test timelocks
  without waiting in real time. See `src/mock-contract.test.ts` for the established patterns
  (failure injection, ledger progression, role enforcement).
- If you change a function's signature or behavior in `contract.ts` or `utils.ts`, update or add a
  test in the corresponding `*.test.ts` file in the same change.
- New example scripts under `examples/` are not covered by the test suite (they exercise a real
  wallet/RPC) — sanity-check them manually with `npx tsx examples/<file>.ts` against testnet before
  submitting.

### CI

SDK tests are not part of `.github/workflows/ci.yml` (only frontend typecheck and contract `cargo check --lib`). Run `npm test` locally before opening a PR that touches `sdk/`.

---

## Adding a New Contract Binding

VaultDAO's TypeScript bindings are partly hand-written (`src/contract.ts`, for the ergonomic
`proposeTransfer`/`approveProposal`/etc. helpers used throughout the README) and partly generated
directly from the deployed WASM via the Stellar CLI (`src/bindings/`).

### 1. Regenerate bindings from the contract WASM

After a change to `contracts/vault/src/lib.rs` that adds or modifies a public contract method:

```bash
# from contracts/vault — build the updated WASM first
cd contracts/vault
cargo build --target wasm32-unknown-unknown --release

# from sdk — regenerate bindings against that WASM
cd ../../sdk
npm run bindings
```

`npm run bindings` runs `stellar contract bindings typescript` against
`../contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm` (see the `bindings`
script in `package.json`). Replace the `<CONTRACT_ID>` placeholder in that script, or pass
`--id <your-deployed-id>` if you're generating against a real deployed instance rather than a
local build — the generated call signatures come from the WASM's interface, not the deployed
state, so a placeholder ID is fine for local development.

### 2. Expose an ergonomic wrapper (if applicable)

Raw generated bindings are functional but low-level. If the new contract method is meant to be a
primary SDK entry point (the way `proposeTransfer`, `approveProposal`, and `createStream` are),
add a corresponding wrapper function in `src/contract.ts` that:

- Takes plain TypeScript types (`string` addresses, `bigint` amounts) rather than raw XDR/ScVal.
- Returns an unsigned transaction XDR string, consistent with every other mutation function in the
  SDK — see [Signing Flow](./README.md#signing-flow) in the README for why the SDK never signs on
  the caller's behalf.
- Is re-exported from `src/index.ts`.

### 3. Add types and tests

- Add any new request/response shapes to `src/types.ts`.
- Add the corresponding mock behavior to `src/mock-contract.ts` so the new method can be tested
  without a live RPC, and add tests in `src/mock-contract.test.ts`.

### 4. Update documentation

- Add a short usage example to the relevant section of `README.md` (following the existing
  pattern: a code block plus 1-2 sentences of context).
- If it's substantial enough to warrant its own example script, add one under `examples/` and list
  it in the README's [Examples](./README.md#examples) table.

---

## Versioning Policy

The SDK follows [Semantic Versioning](https://semver.org/) as declared in `package.json`
(`"version": "0.1.0"`).

- **Patch** (`0.1.x`): Bug fixes, internal refactors, documentation updates — no change to any
  exported function's signature or behavior.
- **Minor** (`0.x.0`): New exported functions/types, new optional parameters with defaults, new
  contract bindings for newly-added contract methods. Existing call sites must keep compiling and
  behaving the same.
- **Major** (`x.0.0`): Any breaking change — removing or renaming an export, changing a function's
  parameter types/order, changing the shape of a returned type, or changing the semantics of an
  existing function (e.g. a function that now throws in a case it previously didn't).

Because the package is still pre-1.0 (`0.x.y`), minor version bumps may occasionally include small
breaking changes per SemVer's pre-1.0 convention — but prefer treating `0.x` bumps as
backwards-compatible in practice, and reserve breaking changes for cases where the alternative
(carrying a deprecated function alongside its replacement) is worse. Always call out any breaking
change explicitly in the PR description, even pre-1.0.

The SDK version is independent of the `contracts/vault` contract version and the `backend` API
version — they are not required to move in lockstep. If a change requires a specific minimum
contract version to function correctly, note that constraint in the changelog/PR description.

---

## Publishing Process

Publishing to npm is a maintainer action, not something contributors do as part of a PR. This
section documents the process for maintainers merging a release.

1. **Ensure `main` is green**: tests pass (`npm test`), the package builds cleanly
   (`npm run build`), and `npm run bindings` output (if regenerated) is committed.
2. **Bump the version** in `sdk/package.json` following [Versioning Policy](#versioning-policy)
   above:
   ```bash
   cd sdk
   npm version patch   # or: minor / major
   ```
   This updates `package.json`'s `"version"` field and creates a git tag.
3. **Publish**:
   ```bash
   npm publish --access public
   ```
   `prepublishOnly` (see `package.json`) automatically runs `npm run build` first, so `dist/` is
   always rebuilt from current `src/` before publishing — never publish from a stale `dist/`.
4. **Push the version tag**: `git push --follow-tags`.
5. **Note the release** in the PR/commit history so SDK consumers can correlate a published npm
   version with the source commit it was built from.

`files` in `package.json` restricts what's published to `dist/` and `README.md` — source files,
tests, and examples are intentionally excluded from the published package to keep it small.

---

## Code Style

- Formatting and linting for the SDK follow the same TypeScript conventions as the rest of the
  repo — see [Code Style Guidelines](../CONTRIBUTING.md#-code-style-guidelines) in the root guide
  (avoid `any`, keep functions focused, prefer explicit types on public API surfaces).
- Every exported function should have a doc comment describing its parameters and return value —
  consumers read these via editor tooltips, and they're the primary API reference alongside
  `README.md`.
- Keep `bigint` for all token amounts (never `number`) — see
  [Amounts and Stroops](./README.md#amounts-and-stroops) in the README for why.
