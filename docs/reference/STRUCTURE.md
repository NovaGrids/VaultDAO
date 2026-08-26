# Project Structure

VaultDAO is organized as a monorepo containing the smart contract, frontend dashboard, backend service, SDK, and documentation.

## Directory Overview

```text
.
├── contracts/          # Soroban smart contracts (Rust)
│   └── vault/
├── frontend/           # Dashboard web app (React)
├── backend/            # Indexing, jobs, notifications, WebSocket API
├── sdk/                # TypeScript SDK for contract integration
├── docs/               # Technical documentation
│   ├── guides/         # How-to guides (features, contribution, ops)
│   │   ├── backend/    # Backend deployment & roadmap
│   │   └── frontend/   # Frontend feature guides (i18n, voice, etc.)
│   └── reference/      # Architecture, API, security, testing, runbooks
├── scripts/            # Deployment and utility scripts
├── terraform/          # Infrastructure as code
├── monitoring/         # Prometheus / Grafana assets
├── load-tests/         # Load testing scripts
├── README.md           # Project entry point
├── CONTRIBUTING.md     # Contributor guidelines
├── CODE_OF_CONDUCT.md  # Community standards
└── LICENSE             # AGPL-3.0
```

## Documentation Layout

### Guides (`docs/guides/`)

Hands-on docs for building and operating features:

- Contribution: `FIRST_CONTRIBUTION.md`, `FRONTEND_CONTRIBUTION.md`, `BACKEND_MODULES.md`
- Product features: recurring payments, delegation, expiration, widgets, etc.
- Ops: `LOCAL_STACK.md`, `TESTNET_DEPLOYMENT.md`, `SIGNING_GUIDE.md`
- `backend/`: backend deployment and roadmap
- `frontend/`: i18n, notifications, voice navigation

### Reference (`docs/reference/`)

Canonical technical docs:

- `ARCHITECTURE.md`, `API.md`, `EVENTS.md`, `STORAGE.md`
- `TESTING.md`, `DEPLOYMENT.md`, `SECURITY.md`, `AUDIT_SCOPE.md`
- `PRODUCTION_RUNBOOK.md`, `INTEGRATION_CHECKLIST.md`, `STRUCTURE.md`

## Component Breakdown

### Smart Contract (`contracts/vault`)

- `src/lib.rs` — protocol logic and contract implementation
- `src/types.rs` — shared data structures and enums
- `src/storage.rs` — Instance / Persistent / Temporary storage helpers
- `src/errors.rs` — contract error codes
- `src/test*.rs` — unit and feature tests

### Frontend (`frontend`)

- `src/components/` — UI building blocks
- `src/hooks/` — contract and app hooks
- `src/app/` — primary views (dashboard, proposals, settings)
- `src/utils/` — formatting and helpers

### Backend (`backend`)

- `src/modules/` — events, proposals, recurring, notifications, websocket, jobs
- `src/shared/` — logging, cache, HTTP helpers
- See [backend roadmap](../guides/backend/ROADMAP.md) for planned work

### Root Files

- `README.md` — quick start
- `CONTRIBUTING.md` — PR workflow and setup
- `CODE_OF_CONDUCT.md` — community expectations
- `LICENSE` — AGPL-3.0
