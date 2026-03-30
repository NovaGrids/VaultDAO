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

### Environment Variables

The backend uses environment variables for configuration. You can find a complete list of these variables in [.env.example](.env.example). 

#### 1. Server Configuration

| Variable | Description | Default | Expected Value | Required? |
| :--- | :--- | :--- | :--- | :--- |
| `PORT` | HTTP port for the backend server | `8787` | Integer (1-65535) | No |
| `HOST` | Network interface the backend binds to | `0.0.0.0` | Non-empty string | **Yes** |
| `NODE_ENV` | Runtime mode for validation | `development` | `development`, `test`, `production` | No |
| `CORS_ORIGIN` | Allowed CORS origins (comma-separated) | `*` (dev), `[]` (prod) | Comma-separated list | **Yes (prod)** |
| `REQUEST_BODY_LIMIT` | Max size for incoming request bodies | `10kb` | Size string (e.g., `1mb`, `10kb`) | No |
| `API_KEY` | Secret key for authenticated routes | - | Non-empty string | **Yes (prod)** |

#### 2. Stellar Network & Contract

| Variable | Description | Default | Expected Value | Required? |
| :--- | :--- | :--- | :--- | :--- |
| `STELLAR_NETWORK` | Target Stellar network | `testnet` | `testnet`, `mainnet`, `futurenet`, `standalone` | No |
| `SOROBAN_RPC_URL` | Soroban RPC base URL | `https://soroban-testnet.stellar.org` | Valid `http` or `https` URL | No |
| `HORIZON_URL` | Horizon API base URL | `https://horizon-testnet.stellar.org` | Valid `http` or `https` URL | No |
| `CONTRACT_ID` | VaultDAO contract identifier | - | Valid Contract ID (starting with `C`) | **Yes** |
| `VITE_WS_URL` | Websocket endpoint for real-time features | `ws://localhost:8080` | Valid `ws` or `wss` URL | No |

#### 3. Polling & Background Jobs

| Variable | Description | Default | Expected Value | Required? |
| :--- | :--- | :--- | :--- | :--- |
| `EVENT_POLLING_ENABLED` | Toggle for event polling service | `true` | `true` or `false` | No |
| `EVENT_POLLING_INTERVAL_MS` | Delay between polling cycles | `10000` | Integer (milliseconds) | No |
| `DUE_PAYMENTS_JOB_ENABLED`| Toggle for due payments job | `true` | `true` or `false` | No |
| `DUE_PAYMENTS_JOB_INTERVAL_MS`| Delay between payment checks | `60000` | Integer (milliseconds) | No |
| `CURSOR_CLEANUP_JOB_ENABLED`| Toggle for cursor cleanup job | `true` | `true` or `false` | No |
| `CURSOR_CLEANUP_JOB_INTERVAL_MS`| Frequency of cleanup | `86400000` | Integer (milliseconds) | No |
| `CURSOR_RETENTION_DAYS` | Days to keep cursors before cleanup | `30` | Integer (days) | No |

#### 4. Storage Configuration

| Variable | Description | Default | Expected Value | Required? |
| :--- | :--- | :--- | :--- | :--- |
| `CURSOR_STORAGE_TYPE` | Storage adapter for event cursors | `file` | `file` or `database` | No |
| `DATABASE_PATH` | Path to SQLite DB if using `database` | `./vaultdao.sqlite`| Valid file path | No |

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

### CORS (Cross-Origin Resource Sharing)

The backend implements CORS protection to control which origins can access the API.

- **Development/Test**: CORS is permissive or follows the `CORS_ORIGIN` environment variable.
- **Production**:
  - Requests with an `Origin` header MUST match the allowed origins specified in `CORS_ORIGIN`.
  - Disallowed origins receive a `403 Forbidden` response.
  - Requests without an `Origin` header (e.g., server-to-server calls, `curl`) are allowed.

## 🚀 Get Started

See the [detailed roadmap](docs/ROADMAP.md) for prioritized tasks.

```
# Quickstart for new contributors
pnpm install
pnpm test
# Pick a Foundation task from ROADMAP.md
```

## API Versioning

All business logic routes are strictly versioned under the `/api/v1/` prefix (e.g., `/api/v1/status`). 
The `/health` and `/ready` validation endpoints are kept at the root level (`/health`, `/ready`) to maintain compatibility with standard Kubernetes probe paths.

## Current Endpoints

- `GET /health` (root)
- `GET /ready` (root)
- `GET /api/v1/status`
