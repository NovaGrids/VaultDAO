# Project Structure

VaultDAO is a monorepo for the Soroban treasury contract, dashboard, support services, and docs.

## Directory overview

```text
.
├── contracts/vault/    # Soroban smart contract (Rust)
├── frontend/           # React dashboard
├── backend/            # Indexing / API scaffold
├── sdk/                # TypeScript SDK
├── docs/               # Guides and reference
│   ├── guides/         # How-tos (features, contribution, ops)
│   └── reference/      # Architecture, API, security, testing
├── terraform/          # Infrastructure as code
├── monitoring/         # Prometheus / Grafana assets
├── load-tests/         # Load testing scripts
├── .github/workflows/  # CI (frontend typecheck + contract check)
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
└── LICENSE
```

## Documentation

See [docs/README.md](../README.md) for the full index.

- **Guides** (`docs/guides/`): contribution, features, frontend, backend, contracts
- **Reference** (`docs/reference/`): architecture, API, security, testing, runbooks

## Components

### Smart contract (`contracts/vault`)

- `src/lib.rs` — contract implementation
- `src/types.rs` — shared types
- `src/storage.rs` — Instance / Persistent / Temporary helpers
- `src/errors.rs` — error codes
- `src/events.rs` — event emitters
- `src/test*.rs` — unit tests (`#[cfg(test)]`)

### Frontend (`frontend`)

- `src/app/` — views
- `src/components/` — UI
- `src/hooks/` — contract and app hooks
- `src/context/` / `src/contexts/` — React providers

### Backend (`backend`)

- `src/modules/` — events, proposals, recurring, notifications, websocket, jobs
- `src/shared/` — logging, cache, HTTP helpers

### CI

GitHub Actions runs two jobs on `main` PRs and pushes:

1. **Frontend** — `npm ci --legacy-peer-deps` + `npm run typecheck`
2. **Contract** — `cargo check --lib`
