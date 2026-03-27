# VaultDAO Backend

This backend is a lightweight support service for VaultDAO. It does not replace the Soroban contract and does not need to modify contract logic to be useful.

## Goals

- provide a clean place for future indexing and notification work
- support websocket, keeper, and alert features later
- keep local quality checks enforced with Husky before bad code is pushed

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

## Docker

Run the backend in a container for consistent local development across different environments.

### Build Image

```bash
docker build -t vaultdao-backend .
```

### Run Container

```bash
# Copy environment file
cp .env.example .env

# Run with default port
docker run --env-file .env -p 8787:8787 vaultdao-backend

# Run with custom port mapping
docker run --env-file .env -p 3000:8787 vaultdao-backend
```

### Development with Volume Mount

For live development with hot reload, mount your source code:

```bash
docker run --env-file .env -p 8787:8787 -v "$(pwd)/src:/app/src" --entrypoint "npm" vaultdao-backend run dev
```

## Environment

Copy the example file and adjust the values for your local environment:

```bash
cp backend/.env.example backend/.env
```

The backend validates its environment at startup and fails fast with clear messages when configuration is invalid.

### Variables

`PORT`

- Purpose: HTTP port for the backend server
- Default: `8787`
- Expected value: integer from `1` to `65535`

`HOST`

- Purpose: network interface the backend binds to
- Default: `0.0.0.0`
- Expected value: non-empty host string

`NODE_ENV`

- Purpose: runtime mode used for validation and environment behavior
- Default: `development`
- Expected value: `development`, `test`, or `production`

`STELLAR_NETWORK`

- Purpose: identifies which Stellar network the backend is targeting
- Default: `testnet`
- Expected value: `testnet`, `mainnet`, `futurenet`, or `standalone`

`SOROBAN_RPC_URL`

- Purpose: Soroban RPC base URL used for contract and network integrations
- Default: `https://soroban-testnet.stellar.org`
- Expected value: valid `http` or `https` URL

`HORIZON_URL`

- Purpose: Horizon API base URL for Stellar account and ledger access
- Default: `https://horizon-testnet.stellar.org`
- Expected value: valid `http` or `https` URL

`CONTRACT_ID`

- Purpose: target VaultDAO contract identifier used by backend integrations
- Default: example placeholder in local development
- Expected value: non-empty contract ID string
- Production note: the example placeholder is rejected when `NODE_ENV=production`

`VITE_WS_URL`

- Purpose: websocket endpoint used for current or future realtime features
- Default: `ws://localhost:8080`
- Expected value: valid `ws` or `wss` URL

## Startup Summary

On boot, the backend logs a short safe config summary so contributors can confirm what the process is using.

Included in logs:

- host
- port
- environment
- Stellar network
- masked contract ID
- Soroban RPC URL
- Horizon URL
- websocket URL

Not included in logs:

- secrets
- tokens
- private keys
- full sensitive values if they are introduced later

## Structure

```text
src/
  index.ts                 # bootstrap entrypoint
  app.ts                   # Express app creation
  server.ts                # startup lifecycle and listening
  config/                  # environment loading and configuration
  modules/
    health/
      health.routes.ts
      health.controller.ts
      health.service.ts
      health.service.test.ts
```

## Architecture

The backend is a **lightweight support layer** for VaultDAO, not a replacement for the Soroban contract.

### Purpose

- Index and query blockchain events asynchronously
- Provide webhooks and notifications (future work)
- Support keepers and alert systems (future work)
- Keep contract logic on-chain; backend handles visibility and notifications

### Responsibilities

| On-Chain (Soroban Contract) | Off-Chain (Backend) |
|---|---|
| Vault creation and updates | Indexing vault events |
| Proposal logic | Storing historical snapshots |
| Cryptographic verification | Real-time status queries |
| Token transfers | Notification delivery |
| State mutations | Analytics and reporting |

### Module Structure

- **config**: Environment validation and bootstrap configuration
- **modules**: Feature-specific logic organized by domain (health, events, etc.)
- **shared**: HTTP utilities, logging, and cross-module helpers

### Rate Limiting

All public endpoints are rate-limited to 100 requests per minute per IP. Return code `429 Too Many Requests` when exceeded.

## Current Endpoints

- `GET /health`
- `GET /ready`
- `GET /api/v1/status`
