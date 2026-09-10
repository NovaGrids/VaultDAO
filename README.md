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
- **Node.js 20+** (22 recommended — Vite 7 requires it)
- [Freighter wallet](https://www.freighter.app/) (optional for live wallet flows)

### Smart contract

```bash
cd contracts/vault
cargo check --lib
cargo build --target wasm32-unknown-unknown --release
```

### Frontend (demo mode — recommended for walkthroughs)

Demo mode loads seeded treasury data so the dashboard works **without a wallet or live contract**.

```bash
cd frontend
cp .env.example .env
# In .env set:
#   VITE_DEMO_MODE=true
#   VITE_CONTRACT_ID / VITE_FEES_ACCOUNT / RPC URLs (see .env.example)

npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:5173`.

Useful demo pages: `/dashboard` (overview), `/dashboard/proposals`, `/dashboard/analytics`.

### Frontend (live testnet)

Set `VITE_DEMO_MODE=false` and point `VITE_CONTRACT_ID` at a deployed VaultDAO contract on Soroban testnet. There is **no fixed public contract ID checked into this repo** right now — deploy from `contracts/vault` (see [docs/guides/contracts/TESTNET_INTEGRATION.md](docs/guides/contracts/TESTNET_INTEGRATION.md)) and paste the Contract ID into `.env`.

### Backend (optional)

```bash
npm --prefix backend install
cp backend/.env.example backend/.env
npm run backend:dev
```

---

## Deploy frontend on Vercel

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Framework preset: Vite (or Other). Build: `npm run build`, Output: `dist`.
4. Install command: `npm install --legacy-peer-deps`
5. Add environment variables (Production):

| Variable | Suggested value |
| --- | --- |
| `VITE_DEMO_MODE` | `true` |
| `VITE_CONTRACT_ID` | placeholder `CD…` is fine in demo mode |
| `VITE_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `VITE_STELLAR_NETWORK` | `TESTNET` |
| `VITE_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `VITE_STELLAR_EXPLORER_URL` | `https://stellar.expert/explorer/testnet` |
| `VITE_FEES_ACCOUNT` | any valid G… address placeholder |

`frontend/vercel.json` rewrites SPA routes to `index.html`.

After deploy, use the Vercel URL in your pitch / GrantFox official links.

---

## CI

Pull requests and pushes to `main` run `.github/workflows/ci.yml`:

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
