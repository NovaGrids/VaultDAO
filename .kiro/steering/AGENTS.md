# VaultDAO Context & Instructions

VaultDAO is a Soroban-native treasury management platform (the "Gnosis Safe of Stellar") designed for high-value Stellar organizations. It implements multi-signature logic, Role-Based Access Control (RBAC), timelocks, and spending limits to ensure secure treasury operations.

## Project Overview

- **Architecture**: Monorepo consisting of:
  - `contracts/vault`: Soroban smart contracts (Rust).
  - `frontend`: React dashboard (Vite + TypeScript).
  - `backend`: Node.js support service (Express + TypeScript) for indexing and notifications.
  - `sdk`: TypeScript SDK for contract integration.
- **Main Technologies**:
  - **Contracts**: Rust, `soroban-sdk`.
  - **Frontend**: React 19, Vite, Tailwind CSS, `stellar-sdk`, `@stellar/freighter-api`, `yjs` (collaboration).
  - **Backend**: Node.js, Express 5, `tsx`, WebSockets.
- **Storage Strategy**:
  - `Instance`: Global config and roles (hot data).
  - `Persistent`: Proposals and recurring payments.
  - `Temporary`: Daily/weekly spending limits (ephemeral data).

## Building and Running

### Smart Contracts
- **Build**: `cd contracts/vault && cargo build --target wasm32-unknown-unknown --release`
- **Test**: `cd contracts/vault && cargo test`
- **Format**: `cargo fmt --all`
- **Lint**: `cargo clippy --all-targets --all-features`

### Frontend
- **Install**: `cd frontend && npm install`
- **Dev**: `npm run dev` (starts on `http://localhost:5173`)
- **Build**: `npm run build`
- **Test**: `npm test`
- **Lint**: `npm run lint`

### Backend
- **Install**: `npm --prefix backend install`
- **Dev**: `npm run backend:dev` (from root)
- **Test**: `npm run backend:test` (from root)
- **Typecheck**: `npm run backend:typecheck` (from root)

### Root Tooling
- **Husky**: Pre-commit hooks run `lint-staged` on backend files.
- **Lint Staged**: Uses Prettier for auto-formatting.

## Development Conventions

### General
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`, `docs:`, `test:`).
- **Workflow**: Work on feature branches (`feature/`, `fix/`, `docs/`).

### Smart Contracts (Rust)
- **Formatting**: Always run `cargo fmt` before committing.
- **Error Handling**: Use the `VaultError` enum in `contracts/vault/src/errors.rs`. **Never panic.**
- **Documentation**: Use `///` doc comments for all public contract functions.
- **Testing**: Add unit tests in `contracts/vault/src/test.rs` (or specific test files like `test_audit.rs`).

### Frontend (TypeScript/React)
- **Styles**: Use Tailwind CSS. Components should follow a "premium glassmorphism" aesthetic.
- **State**: Use React Hooks and Context. Avoid `any` types.
- **Icons**: Use `lucide-react`.
- **Naming**: `PascalCase` for components, `camelCase` for functions and variables.
- **Component Size**: Keep components under 150 lines where possible.

### Backend (Node.js)
- **Execution**: Use `tsx` for development and `node` for production.
- **API**: Follow RESTful conventions.
- **Validation**: Use TypeScript for type safety across the service.

## Key Files
- `contracts/vault/src/lib.rs`: Main contract entry point.
- `contracts/vault/src/types.rs`: Core data structures (Proposals, Roles).
- `frontend/src/App.tsx`: Main React entry point.
- `backend/src/index.ts`: Backend entry point.
- `docs/reference/ARCHITECTURE.md`: Deep dive into system design.
- `docs/reference/SECURITY.md`: Security policies and threat model.
