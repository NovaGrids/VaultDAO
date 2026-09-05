# VaultDAO

<div align="center">
  <img src="https://img.shields.io/badge/Stellar-Soroban-purple" alt="Stellar Soroban" />
  <img src="https://img.shields.io/badge/Security-Rust-orange" alt="Rust" />
  <img src="https://img.shields.io/badge/Status-Testnet-green" alt="Status" />
  <img src="https://github.com/NovaGrids/VaultDAO/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI Status" />
</div>

**VaultDAO** is a Soroban-native treasury management dApp for high-value Stellar organizations — multi-sig security with the speed of Soroban.

Think of it as the **"Gnosis Safe of Stellar"** — built for DAOs, enterprise treasuries, and investment clubs.

---

## Features

| Feature | Description |
| --- | --- |
| **Multi-Signature** | M-of-N signing enforced on-chain |
| **RBAC** | Admin, Treasurer, Member roles |
| **Timelocks** | Large transfers locked before execution |
| **Spending Limits** | Daily and weekly allowances |
| **Recurring Payments** | Payroll and subscriptions with interval checks |

---

## Repository layout

| Path | Purpose |
| --- | --- |
| `contracts/vault/` | Soroban smart contract (Rust) |
| `frontend/` | React dashboard |
| `backend/` | Indexing / API scaffold |
| `sdk/` | TypeScript SDK |
| `docs/` | [Guides and reference](docs/README.md) |

---

## Getting started

### Prerequisites

- Rust (1.70+) with `wasm32-unknown-unknown`
- Node.js 18+
- [Freighter wallet](https://www.freighter.app/)

### Smart contract

```bash
cd contracts/vault
cargo check --lib
cargo build --target wasm32-unknown-unknown --release
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:5173`.

### Backend (optional)

```bash
npm --prefix backend install
cp backend/.env.example backend/.env
npm run backend:dev
```

---

## CI

Pull requests and pushes to `main` run a simple workflow (`.github/workflows/ci.yml`):

1. **Frontend** — install + TypeScript typecheck
2. **Contract** — `cargo check --lib`

---

## Docs & contributing

- Documentation index: [docs/README.md](docs/README.md)
- Architecture: [docs/reference/ARCHITECTURE.md](docs/reference/ARCHITECTURE.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [docs/reference/SECURITY.md](docs/reference/SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

AGPL-3.0 — see [LICENSE](LICENSE).
