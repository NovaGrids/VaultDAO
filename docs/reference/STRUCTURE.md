# Project Structure

VaultDAO is organized as a monorepo containing the smart contract, the frontend dashboard, and supporting documentation.

## Directory Overview

```text
.
├── contracts/          # Soroban Smart Contracts (Rust)
│   └── vault/
│       ├── src/        # Contract source code
│       └── Cargo.toml  # Rust dependencies
├── frontend/           # Dashboard Web App (React)
│   ├── src/            # Application source (TypeScript)
│   ├── public/         # Static assets
│   └── package.json    # Javascript dependencies
├── docs/               # Technical documentation & guides
├── sdk/                # TypeScript SDK for contract integration
├── scripts/            # Deployment and utility scripts
├── README.md           # Main project entry point
└── CONTRIBUTING.md     # Contributor guidelines
```

## Detailed Component Breakdown

### 🛡️ Smart Contract (`/contracts/vault`)

- **`src/lib.rs`**: Contains the protocol logic and main contract implementation.
- **`src/types.rs`**: Logic for data structures, roles, and enums used across the contract.
- **`src/storage.rs`**: Abstracted storage access patterns for Instance, Persistent, and Temporary storage.
- **`src/errors.rs`**: Definition of all contract-specific error codes returned to callers.
- **`src/test.rs`**: Automated test suite for validating multi-sig, timelocks, and limits.

### 💻 Frontend (`/frontend`)

- **`src/components/`**: UI building blocks (Modals, Cards, Buttons, Status Badges).
- **`src/hooks/`**: Custom React hooks for interacting with the blockchain.
  - `useVaultContract.ts`: Logic for invoking contract methods like `propose_transfer` or `approve_proposal`.
- **`src/app/`**: Primary application views (Dashboard, Proposals, Settings).
- **`src/utils/`**: Helper functions for formatting addresses, dates, and amounts.

### 📚 Documentation (`/docs`)

- **`reference/TESTING.md`**: Guide on running and writing contract tests.
- **`reference/DEPLOYMENT.md`**: Instructions for deploying to Testnet and Mainnet.
- **`reference/API.md`**: Technical reference for contract functions and data types.
- **`reference/ARCHITECTURE.md`**: High-level system design and data flow diagrams.
- **`reference/SECURITY.md`**: Vulnerability disclosure and security practices.
- **`guides/`**: Feature-specific guides (delegation, expiration, widgets, etc.).

### 📜 Root Files

- **`README.md`**: Project entry point and quick start.
- **`CONTRIBUTING.md`**: Contributor guidelines and PR workflow.
- **`LICENSE`**: AGPL-3.0 License details.

