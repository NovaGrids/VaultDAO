# Local Development Stack Guide

> **A complete step-by-step guide to running the VaultDAO full local development stack: Soroban smart contract + Node.js backend + React frontend + local Stellar network.**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Repository Structure](#3-repository-structure)
4. [Local Stellar Network Setup](#4-local-stellar-network-setup)
5. [Running the Full Stack with Docker Compose](#5-running-the-full-stack-with-docker-compose)
6. [Contract Deployment to Local Network](#6-contract-deployment-to-local-network)
7. [Freighter Wallet — Custom Network Configuration](#7-freighter-wallet--custom-network-configuration)
8. [Environment Variable Reference](#8-environment-variable-reference)
9. [Running Services Individually](#9-running-services-individually)
10. [Troubleshooting](#10-troubleshooting)
11. [Resetting the Local Stack](#11-resetting-the-local-stack)
12. [Quick Reference Cards](#12-quick-reference-cards)

---

## 1. Overview

VaultDAO is a Soroban-native treasury management dApp. The full local stack consists of four components that run together during development:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Smart Contract** | Rust / Soroban | On-chain multi-signature treasury logic |
| **Stellar Node** | Stellar Core + Soroban RPC | Local blockchain for contract deployment & testing |
| **Backend** | Node.js / Express | Event indexing, health checks, authentication |
| **Frontend** | React / Vite / TypeScript | Dashboard UI connected via Freighter wallet |

The Docker Compose manifest (`docker-compose.yml`) orchestrates the backend and frontend services together. The local Stellar network and contract deployment are run separately.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Stack                      │
│                                                             │
│  ┌──────────┐     ┌──────────┐     ┌──────────────────┐    │
│  │  Redis    │◄────│ Backend  │◄────│  Frontend (Vite) │    │
│  │ (:6379)  │     │ (:8787)  │     │    (:5173)       │    │
│  └──────────┘     └────┬─────┘     └────────┬─────────┘    │
│                        │                     │              │
└────────────────────────┼─────────────────────┼──────────────┘
                         │                     │
                  ┌──────▼─────────────────────▼──────┐
                  │        Freighter Wallet            │
                  │        (Browser Extension)         │
                  └────────────────┬───────────────────┘
                                   │
                  ┌────────────────▼───────────────────┐
                  │    Local Stellar Node (Soroban RPC) │
                  │         http://localhost:8000        │
                  └────────────────────────────────────┘
```

---

## 2. Prerequisites

### Required Software

| Tool | Version | Installation |
|------|---------|-------------|
| **Docker** | 24.0+ | [Install Docker Desktop](https://docs.docker.com/get-docker/) |
| **Docker Compose** | 2.20+ | Included with Docker Desktop; verify with `docker compose version` |
| **Rust** | 1.70+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| **WASM Target** | — | `rustup target add wasm32-unknown-unknown` |
| **Stellar CLI** | Latest | `cargo install --locked stellar-cli` |
| **jq** (optional) | 1.6+ | [Install jq](https://jqlang.org/download/) — used by the deployment script to parse JSON output |
| **Node.js** | 18+ | [Install Node.js](https://nodejs.org/) |
| **Freighter Wallet** | Latest | [Freighter Browser Extension](https://www.freighter.app/) |

### Verify Prerequisites

```bash
# Docker
docker --version            # Should show 24.0+
docker compose version       # Should show 2.20+

# Rust & WASM
rustc --version              # Should show rustc 1.70+
rustup target list --installed | grep wasm32

# Stellar CLI
stellar --version

# Node.js
node --version               # Should show v18+
npm --version

# Git
git --version
```

### Docker Compose Version Requirements

- The `docker-compose.yml` uses **version 3.8** schema, which requires Docker Engine 19.03.0+.
- The `env_file` block with `required: false` syntax requires **Docker Compose v2.20+**.
- If you encounter `field 'required' not found` errors, upgrade Docker Desktop or Docker Compose:
  ```bash
  # Check version
  docker compose version

  # Upgrade Docker Compose (Linux standalone)
  sudo apt-get update && sudo apt-get install docker-compose-plugin
  ```

### Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 5 GB free | 20 GB free |

---

## 3. Repository Structure

```
VaultDAO/
├── contracts/
│   └── vault/                     # Soroban smart contract (Rust)
│       ├── src/
│       │   ├── lib.rs             # Main contract logic
│       │   ├── types.rs           # Data structures (Proposal, Config, etc.)
│       │   ├── storage.rs         # Storage management
│       │   ├── events.rs          # On-chain event emissions
│       │   └── test*.rs           # Test files
│       └── Cargo.toml
├── backend/                       # Node.js Express backend
│   ├── src/
│   │   ├── index.ts               # Bootstrap entrypoint
│   │   ├── app.ts                 # Express app creation
│   │   ├── server.ts              # Startup lifecycle
│   │   ├── config/                # Environment loading & validation
│   │   └── modules/
│   │       ├── health/            # Health check endpoints
│   │       └── events/            # Event indexing & polling
│   ├── .env.example               # Environment variable template
│   └── Dockerfile
├── frontend/                      # React Vite dashboard
│   ├── src/
│   ├── .env.example               # Environment variable template
│   └── Dockerfile
├── docker-compose.yml             # Multi-service orchestration
└── README.md                      # Project overview & quick start
```

---

## 4. Local Stellar Network Setup

The docker-compose stack does NOT include a Stellar node service. You must start a local Stellar standalone network separately.

### Option A: Using Stellar Quickstart Image (Recommended)

The Stellar team provides an all-in-one Docker image that bundles Stellar Core, Horizon, and Soroban RPC:

```bash
# Pull the latest quickstart image
docker pull stellar/quickstart:soroban-dev

# Start a local standalone network
docker run --rm -it \
  -p 8000:8000 \
  -p 11625:11625 \
  -p 11626:11626 \
  --name stellar-local \
  stellar/quickstart:soroban-dev \
  --local \
  --enable-soroban-rpc
```

**What this does:**
- Starts a **standalone** Stellar network (isolated, no connection to testnet/mainnet)
- Enables **Soroban RPC** on `http://localhost:8000`
- Starts **Horizon** API
- Pre-generates a root account with 100B XLM

**Verify the node is running:**

```bash
# Check Soroban RPC
curl -X POST http://localhost:8000/soroban/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}

# Check Horizon
curl http://localhost:8000/horizon/
```

**Note:** The first startup may take 30–60 seconds while the node initializes. Wait for the logs to show `Starting Soroban RPC` before proceeding.

### Option B: Using soroban-cli / stellar-cli (Standalone Network)

If you prefer not to use Docker for the Stellar node:

```bash
# Start a local standalone network via stellar-cli
soroban container start

# Or on older stellar-cli versions:
# stellar network start --name local --rpc-url http://localhost:8000

# Verify
curl -X POST http://localhost:8000/soroban/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

### Option C: Soroban Preview (Minimal)

For contract-only development without Horizon:

```bash
# Start a minimal Soroban RPC instance
stellar container start
```

This starts a lightweight local RPC server on port 8000. It does **not** include Horizon — use this only when you need to test contract interactions without account history queries.

---

## 5. Running the Full Stack with Docker Compose

Once the local Stellar network is running (Section 4), start the backend and frontend:

### Step 1: Prepare Environment Files

```bash
# From the repository root

# Backend environment
cp backend/.env.example backend/.env

# Frontend environment
cp frontend/.env.example frontend/.env
```

### Step 2: Configure Environment Variables

Edit `backend/.env` and set at minimum:

```bash
# Point to your local Stellar network
STELLAR_NETWORK=standalone
SOROBAN_RPC_URL=http://host.docker.internal:8000/soroban/rpc
HORIZON_URL=http://host.docker.internal:8000/horizon

# Contract ID — you'll get this after deploying (see Section 6)
CONTRACT_ID=CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Redis (uses the docker compose service name)
REDIS_HOST=redis
REDIS_PORT=6379
```

Edit `frontend/.env` and set:

```bash
VITE_STELLAR_NETWORK=STANDALONE
VITE_STELLAR_NETWORK_PASSPHRASE=Standalone Network ; February 2017
VITE_SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
VITE_HORIZON_URL=http://localhost:8000/horizon
VITE_CONTRACT_ID=CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

> **Note about `host.docker.internal`:** The backend runs inside a Docker container. To reach the Stellar node running on your host machine, use `host.docker.internal` instead of `localhost`. On Linux, you may need to add `--add-host host.docker.internal:host-gateway` to the Stellar node container or use the host network mode.

### Step 3: Start the Stack

```bash
# From the repository root
docker compose up

# To run in detached mode (background):
docker compose up -d

# To rebuild images after dependency changes:
docker compose up --build
```

### Step 4: Verify All Services Are Running

```bash
# Check container status
docker compose ps

# Expected output:
# NAME                  IMAGE                    STATUS    PORTS
# vaultdao-redis        redis:7-alpine           Up        0.0.0.0:6379->6379/tcp
# vaultdao-backend      vaultdao-backend         Up        0.0.0.0:8787->8787/tcp
# vaultdao-frontend     vaultdao-frontend        Up        0.0.0.0:5173->5173/tcp

# Check backend health
curl http://localhost:8787/health

# Check backend API status
curl http://localhost:8787/api/v1/status

# Check frontend
Open http://localhost:5173 in your browser
```

### What Happens at Startup

1. **Redis** starts first (depends on health check)
2. **Backend** starts after Redis is healthy:
   - Validates environment variables (fails fast with clear messages)
   - Connects to Redis
   - Begins event polling (if enabled)
   - Logs a config summary
3. **Frontend** starts in parallel:
   - Vite dev server binds to `0.0.0.0:5173`
   - Hot-reloading enabled via volume mount
   - Connects to Freighter wallet on page load

### Startup Order Dependency Graph

```
Local Stellar Node (host, Section 4)
       │
       ▼
   Redis (Docker)
       │
       ▼
  Backend (Docker) ─────► Frontend (Docker)
```

---

## 6. Contract Deployment to Local Network

Once the Stellar node is running, deploy the VaultDAO smart contract:

### Step 1: Build the Contract

```bash
# From the repository root
cd contracts/vault

# Build for WASM
cargo build --target wasm32-unknown-unknown --release

# Verify the .wasm file was created
ls -la target/wasm32-unknown-unknown/release/vault_dao.wasm
```

**Note:** The `--release` flag is important for production-like optimization. Debug builds produce larger WASM files that may exceed Soroban's contract size limits.

### Step 2: Create and Fund a Deployer Account

```bash
# Generate a new keypair for deployment
stellar keys generate deployer --network local

# Fund the deployer account from the root account
# (The quickstart image's root account has 100B XLM)
stellar keys fund deployer --network local

# Verify the balance
stellar keys balance deployer --network local
```

### Step 3: Deploy the Contract

```bash
# Deploy the WASM to the local Stellar node
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/vault_dao.wasm \
  --source deployer \
  --network local

# Example output:
# Contract deployed successfully!
# Contract ID: CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Save this contract ID — you'll need it for .env files
```

### Step 4: Verify Deployment

```bash
# Check that the contract exists
stellar contract id --network local

# Get contract info
stellar contract info \
  --id CC_X_REDACTED \
  --network local
```

### Step 5: Initialize the Contract

```bash
# Generate test accounts for the vault
stellar keys generate admin --network local
stellar keys generate treasurer1 --network local
stellar keys generate treasurer2 --network local

# Fund them
stellar keys fund admin --network local
stellar keys fund treasurer1 --network local
stellar keys fund treasurer2 --network local

# Initialize the vault contract with basic configuration
# (Replace CC_X_REDACTED with your deployed contract ID)
stellar contract invoke \
  --id CC_X_REDACTED \
  --source admin \
  --network local \
  -- \
  initialize \
  --admin $(stellar keys address admin) \
  --signers '["'$(stellar keys address admin)'","'$(stellar keys address treasurer1)'","'$(stellar keys address treasurer2)'"]' \
  --threshold 2
```

### Step 6: Get Test XLM for Other Accounts

```bash
# Fund additional test accounts via the friendbot endpoint
# (the local node has a friendbot at /friendbot)
curl "http://localhost:8000/friendbot?addr=$(stellar keys address treasurer1)"
curl "http://localhost:8000/friendbot?addr=$(stellar keys address treasurer2)"
```

### Step 7: Update .env Files with the Contract ID

Once deployed, update both `.env` files:

```bash
# backend/.env
CONTRACT_ID=CC...your-deployed-contract-id...

# frontend/.env
VITE_CONTRACT_ID=CC...your-deployed-contract-id...
```

### Contract Deployment Script (All-in-One)

Save the following as `scripts/deploy-local.sh` for future use:

```bash
#!/bin/bash
set -euo pipefail

echo "=== Building contract ==="
cd contracts/vault
cargo build --target wasm32-unknown-unknown --release

echo "=== Generating deployer key ==="
stellar keys generate deployer --network local 2>/dev/null || true
stellar keys fund deployer --network local

echo "=== Deploying contract ==="
CONTRACT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/vault_dao.wasm \
  --source deployer \
  --network local \
  --output json 2>/dev/null | grep -oP '\"contract_id\"\s*:\s*\"\K\w+' 2>/dev/null || \
  stellar contract deploy \
    --wasm target/wasm32-unknown-unknown/release/vault_dao.wasm \
    --source deployer \
    --network local | grep -oP 'Contract ID: \K\w+')

echo "Contract ID: $CONTRACT_ID"

echo "=== Generating test accounts ==="
for acct in admin treasurer1 treasurer2; do
  stellar keys generate "$acct" --network local 2>/dev/null || true
  stellar keys fund "$acct" --network local
done

echo "=== Initializing contract ==="
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin \
  --network local \
  -- \
  initialize \
  --admin "$(stellar keys address admin)" \
  --signers '["'$(stellar keys address admin)'","'$(stellar keys address treasurer1)'","'$(stellar keys address treasurer2)'"]' \
  --threshold 2

echo "=== Done ==="
echo "Contract ID: $CONTRACT_ID"
echo "Add this to your .env files."
```

---

## 7. Freighter Wallet — Custom Network Configuration

Freighter must be configured to connect to your local Stellar network instead of testnet or mainnet.

### Step 1: Open Freighter Settings

1. Click the Freighter extension icon in your browser toolbar
2. Click the gear icon (⚙️) in the top-right corner
3. Select **"Networks"** from the settings menu

### Step 2: Add Custom Network

1. Scroll to the bottom and click **"Add Custom Network"**
2. Fill in the following fields:

| Field | Value |
|-------|-------|
| **Network Name** | `VaultDAO Local` |
| **Horizon URL** | `http://localhost:8000/horizon` |
| **Soroban RPC URL** | `http://localhost:8000/soroban/rpc` |
| **Network Passphrase** | `Standalone Network ; February 2017` |
| **Network** | `STANDALONE` |
| **Allow HTTP connection** | ✔️ Toggle ON |

3. Click **"Save"**

### Step 3: Switch to Local Network

1. In the networks dropdown, select **"VaultDAO Local"**
2. The wallet should now show your local test accounts
3. Verify connection by checking the network indicator (should show green/connected)

### Step 4: Import Test Accounts into Freighter

To interact with the dApp, you need to import one of the keypairs you created via `stellar keys`:

```bash
# Get the private key for an account
stellar keys show admin
```

1. In Freighter, click **"Add Account"** → **"Import Secret Key"**
2. Paste the private key shown by `stellar keys show`
3. Give it a label like "Local Admin"
4. Click **"Import"**

> **⚠️ Security Warning:** The private keys shown by `stellar keys show` are for local development only. Never use these seed phrases on mainnet.

### Verifying Freighter Connection

1. Open `http://localhost:5173` in your browser
2. Click **"Connect Wallet"**
3. Freighter should prompt you to select an account
4. After connecting, the dashboard should show your local account's balance

---

## 8. Environment Variable Reference

### Backend Environment Variables (`backend/.env`)

#### Server Configuration

| Variable | Description | Default | Local Dev Value | Required |
|----------|-------------|---------|-----------------|----------|
| `PORT` | HTTP port for the backend server | `8787` | `8787` | No |
| `HOST` | Network interface to bind | `0.0.0.0` | `0.0.0.0` | **Yes** |
| `NODE_ENV` | Runtime mode | `development` | `development` | No |
| `CORS_ORIGIN` | Allowed CORS origins (comma-separated) | `*` | `*` | **Yes (prod)** |
| `REQUEST_BODY_LIMIT` | Max request body size | `10kb` | `10kb` | No |
| `API_KEY` | Secret key for authenticated routes | — | *(leave empty)* | **Yes (prod)** |

#### Stellar Network & Contract

| Variable | Description | Default | Local Dev Value | Required |
|----------|-------------|---------|-----------------|----------|
| `STELLAR_NETWORK` | Target Stellar network | `testnet` | `standalone` | No |
| `SOROBAN_RPC_URL` | Soroban RPC base URL | `https://soroban-testnet.stellar.org` | `http://host.docker.internal:8000/soroban/rpc` | No |
| `HORIZON_URL` | Horizon API base URL | `https://horizon-testnet.stellar.org` | `http://host.docker.internal:8000/horizon` | No |
| `CONTRACT_ID` | Deployed VaultDAO contract ID | — | *Get from Section 6* | **Yes** |
| `VITE_WS_URL` | WebSocket endpoint | `ws://localhost:8080` | `ws://localhost:8080` | No |

#### Event Polling & Background Jobs

| Variable | Description | Default | Local Dev Value | Required |
|----------|-------------|---------|-----------------|----------|
| `EVENT_POLLING_ENABLED` | Toggle event polling | `true` | `true` | No |
| `EVENT_POLLING_INTERVAL_MS` | Polling frequency (ms) | `10000` | `10000` | No |
| `DUE_PAYMENTS_JOB_ENABLED` | Toggle due payments job | `true` | `true` | No |
| `DUE_PAYMENTS_JOB_INTERVAL_MS` | Payment check frequency (ms) | `60000` | `60000` | No |
| `CURSOR_CLEANUP_JOB_ENABLED` | Toggle cursor cleanup | `true` | `true` | No |
| `CURSOR_CLEANUP_JOB_INTERVAL_MS` | Cleanup frequency (ms) | `86400000` | `86400000` | No |
| `CURSOR_RETENTION_DAYS` | Cursor retention period | `30` | `30` | No |
| `PROPOSAL_ARCHIVAL_JOB_ENABLED` | Toggle proposal archival | `true` | `true` | No |
| `PROPOSAL_ARCHIVAL_JOB_INTERVAL_MS` | Archival frequency (ms) | `86400000` | `86400000` | No |
| `PROPOSAL_ARCHIVAL_THRESHOLD_DAYS` | Archival age threshold | `180` | `180` | No |
| `PROPOSAL_HOT_STORAGE_DAYS` | Hot storage window | `7` | `7` | No |

#### Storage Configuration

| Variable | Description | Default | Local Dev Value | Required |
|----------|-------------|---------|-----------------|----------|
| `CURSOR_STORAGE_TYPE` | Storage adapter for cursors | `file` | `file` | No |
| `DATABASE_PATH` | Path to SQLite database | `./vaultdao.sqlite` | `./vaultdao.sqlite` | No |

#### Redis & Rate Limiting

| Variable | Description | Default | Local Dev Value | Required |
|----------|-------------|---------|-----------------|----------|
| `REDIS_HOST` | Redis hostname | — | `redis` | No |
| `REDIS_PORT` | Redis port | — | `6379` | No |
| `RATE_LIMIT_ENABLED` | Toggle rate limiting | `true` | `true` | No |
| `RATE_LIMIT_REDIS_URL` | Redis connection string | — | `redis://redis:6379` | No |
| `RATE_LIMIT_PROPOSALS_PER_MIN` | Proposals rate limit | `100` | `100` | No |
| `RATE_LIMIT_EXECUTE_PER_MIN` | Execute rate limit | `10` | `10` | No |
| `RATE_LIMIT_DEFAULT_PER_MIN` | Default rate limit | `60` | `60` | No |

### Frontend Environment Variables (`frontend/.env`)

| Variable | Description | Testnet Value | Local Dev Value | Required |
|----------|-------------|---------------|-----------------|----------|
| `VITE_STELLAR_NETWORK` | Network name | `TESTNET` | `STANDALONE` | **Yes** |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` | `Standalone Network ; February 2017` | **Yes** |
| `VITE_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` | `http://localhost:8000/soroban/rpc` | **Yes** |
| `VITE_HORIZON_URL` | Horizon API URL | `https://horizon-testnet.stellar.org` | `http://localhost:8000/horizon` | No |
| `VITE_CONTRACT_ID` | Deployed contract address | *Deploy on testnet* | *Deploy locally (Section 6)* | **Yes** |
| `VITE_STELLAR_EXPLORER_URL` | Block explorer URL | `https://stellar.expert/explorer/testnet` | `http://localhost:8000/horizon` | No |
| `VITE_FEES_ACCOUNT` | Fee account for simulations | *Funded account* | *Your local account* | **Yes** |
| `VITE_REALTIME_WS_URL` | Realtime WebSocket | `ws://localhost:3001` | `ws://localhost:3001` | No |
| `VITE_COLLAB_WS_URL` | Collaboration WebSocket | `ws://localhost:1234` | `ws://localhost:1234` | No |
| `VITE_IPFS_API_URL` | IPFS API endpoint | `http://localhost:5001` | `http://localhost:5001` | No |
| `VITE_IPFS_GATEWAY` | IPFS gateway URL | `https://ipfs.io/ipfs/` | `https://ipfs.io/ipfs/` | No |
| `VITE_APP_ENV` | Application environment | `development` | `development` | No |
| `VITE_DEBUG_MODE` | Enable debug logging | `true` | `true` | No |

### Docker Compose Environment Variables

The `docker-compose.yml` defines default fallback values for the backend service. These can be overridden:

- **Via `backend/.env` file** (mounted automatically with `required: false`)
- **Via environment variables on the host** before running `docker compose up`
- **By editing `docker-compose.yml` directly**

---

## 9. Running Services Individually

While Docker Compose is the recommended approach, you can run each service individually for faster iteration.

### Backend (Outside Docker)

```bash
cd backend

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env — set REDIS_HOST=localhost, SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc

# Start with hot reload
npm run dev
```

**Redis is still required** when running the backend outside Docker:
```bash
docker run -d --name vaultdao-redis -p 6379:6379 redis:7-alpine
```

### Frontend (Outside Docker)

```bash
cd frontend

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env — set VITE_SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc

# Start Vite dev server
npm run dev
```

The frontend will be available at `http://localhost:5173`.

### Smart Contract (Standalone)

```bash
cd contracts/vault

# Run tests
cargo test

# Build
cargo build --target wasm32-unknown-unknown --release

# Run specific test
cargo test test_execution_window_allows_execution_within_window -- --nocapture
```

---

## 10. Troubleshooting

### Issue 1: Port Already in Use

**Symptoms:**
- Docker Compose fails with `port is already allocated`
- Backend or frontend won't start

**Solutions:**

```bash
# Find what's using a port
# On macOS/Linux:
lsof -i :8787
lsof -i :5173
lsof -i :6379
lsof -i :8000

# On Windows (PowerShell):
netstat -ano | findstr :8787
netstat -ano | findstr :5173
netstat -ano | findstr :6379

# Kill the process
# macOS/Linux:
kill -9 <PID>

# Windows:
taskkill /PID <PID> /F

# Or use a different port by editing docker-compose.yml:
# Change "8787:8787" to "8788:8787"
```

**Prevention:** Stop any other Stellar-related services before starting the local stack.

### Issue 2: Freighter Can't Connect to Local Node

**Symptoms:**
- "Network error" or "Can't connect to network" in Freighter
- Transactions fail with timeout

**Solutions:**

1. **Verify the Stellar node is running:**
   ```bash
   curl -X POST http://localhost:8000/soroban/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

2. **Check Freighter network configuration:**
   - Open Freighter → Settings → Networks
   - Verify "VaultDAO Local" has the correct URLs:
     - Horizon: `http://localhost:8000/horizon`
     - Soroban RPC: `http://localhost:8000/soroban/rpc`
   - Ensure **"Allow HTTP connection"** is enabled

3. **Clear Freighter cache:**
   - Open Freighter → Settings → General
   - Click **"Clear Wallet Session"** (you'll need to re-enter your password)
   - Reconnect to the dApp

4. **Switch network back and forth:**
   - Switch to Testnet, wait 5 seconds, then switch back to "VaultDAO Local"

5. **Restart the Stellar node:**
   ```bash
   docker stop stellar-local
   docker start stellar-local
   # Wait 30 seconds for it to initialize
   ```

### Issue 3: Contract Deployment Fails

**Symptoms:**
- `stellar contract deploy` returns an error
- WASM file not found
- RPC connection refused

**Solutions:**

1. **Check that the local Stellar node is running:**
   ```bash
   docker ps | grep stellar
   # If not running, restart it:
   docker start stellar-local
   ```

2. **Verify the WASM file exists:**
   ```bash
   ls -la contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm
   # If not present, rebuild:
   cd contracts/vault && cargo build --target wasm32-unknown-unknown --release
   ```

3. **Check the Stellar CLI network configuration:**
   ```bash
   stellar network ls
   # If "local" network is missing:
   stellar network add \
     --name local \
     --rpc-url http://localhost:8000/soroban/rpc \
     --horizon-url http://localhost:8000/horizon \
     --network-passphrase "Standalone Network ; February 2017"
   ```

4. **Fund the deployer account:**
   ```bash
   stellar keys fund deployer --network local
   # If "account does not exist", check friendbot:
   curl "http://localhost:8000/friendbot?addr=$(stellar keys address deployer)"
   ```

5. **WASM file too large:** If you get a contract size error, ensure you're using `--release`:
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   # NOT: cargo build --target wasm32-unknown-unknown
   ```
   Debug builds can be 2-3x larger than release builds.

### Issue 4: Backend Fails with "host.docker.internal not found"

**Symptoms:**
- Backend logs show `connect ECONNREFUSED host.docker.internal:8000`
- Backend crashes on startup

**Solutions:**

1. **On macOS/Windows:** `host.docker.internal` is available by default. No action needed.

2. **On Linux:** Add the following flag when starting the Stellar node:
   ```bash
   docker run --rm -it \
     -p 8000:8000 \
     --add-host host.docker.internal:host-gateway \
     --name stellar-local \
     stellar/quickstart:soroban-dev \
     --local \
     --enable-soroban-rpc
   ```

3. **Alternative:** Use the host network mode:
   ```bash
   # In docker-compose.yml, for the backend service:
   network_mode: "host"
   # Then set SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
   ```

4. **Alternative:** Use container name-based networking:
   - Start the Stellar node with `--network vaultdao-shared-network`
   - Then use `http://stellar-local:8000/soroban/rpc` in backend env

### Issue 5: Docker Build Fails with npm/node Errors

**Symptoms:**
- `docker compose up --build` fails
- npm install errors during Docker build

**Solutions:**

1. **Clear Docker build cache:**
   ```bash
   docker compose build --no-cache
   ```

2. **Check Node.js version compatibility:**
   - The backend requires Node.js 18+
   - The frontend requires Node.js 16+
   - Check `backend/Dockerfile` and `frontend/Dockerfile` for the base image version

3. **Regenerate lock files:**
   ```bash
   cd backend && rm -rf node_modules package-lock.json && npm install
   cd ../frontend && rm -rf node_modules package-lock.json && npm install
   ```

4. **Increase Docker memory allocation:**
   - Docker Desktop → Settings → Resources → Advanced
   - Increase RAM to at least 6 GB
   - Increase Swap to at least 2 GB

### Issue 6: Frontend Shows Blank Page or Console Errors

**Symptoms:**
- The frontend loads but shows a white screen
- Console shows CORS or network errors

**Solutions:**

1. **Check the browser console** (F12 → Console tab) for specific errors
2. **Verify Freighter is installed and connected:**
   - The app requires Freighter to be installed
   - A blank page often means Freighter is missing or blocked
3. **Clear browser cache and reload:**
   ```bash
   # Hard refresh
   Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
   ```
4. **Check Vite dev server is running:**
   ```bash
   curl http://localhost:5173
   # Should return HTML
   ```
5. **CORS errors:** The Vite dev server proxies API calls. If you see CORS errors, check `vite.config.ts` for the proxy configuration.

### Issue 7: Redis Connection Refused

**Symptoms:**
- Backend logs show `connect ECONNREFUSED 127.0.0.1:6379`
- Rate limiting or caching features not working

**Solutions:**

1. **When running backend outside Docker:** Start Redis manually:
   ```bash
   docker run -d --name vaultdao-redis -p 6379:6379 redis:7-alpine
   ```

2. **When running backend in Docker:** Redis should be started by Docker Compose. Check:
   ```bash
   docker compose ps redis
   # If not running:
   docker compose start redis
   ```

3. **Check Redis logs:**
   ```bash
   docker compose logs redis
   ```

4. **Backend falls back gracefully:** The backend is designed to work without Redis (falls back to in-memory stores). If Redis is truly unavailable, set `RATE_LIMIT_ENABLED=false` in `backend/.env`.

### Issue 8: Database State Mismatch

**Symptoms:**
- Backend shows stale or incorrect data
- Contract events not reflecting in the database

**Solutions:**
1. This is expected during development — delete the SQLite database to reset:
   ```bash
   # When running in Docker:
   docker compose down -v

   # When running outside Docker:
   rm backend/vaultdao.sqlite
   ```
2. See [Resetting the Local Stack](#11-resetting-the-local-stack) below for a full reset procedure.

---

## 11. Resetting the Local Stack

Sometimes you need to wipe all state and start fresh — for example, after a contract upgrade or when database state gets corrupted.

### Quick Reset (Docker Volumes Only)

```bash
# Stop all containers and delete volumes
docker compose down -v

# Verify volumes are removed
docker volume ls | grep vaultdao
```

### Full Reset (Everything)

```bash
#!/bin/bash
set -e

echo "=== Full Stack Reset ==="

# 1. Stop all Docker containers
echo "Stopping Docker containers..."
docker compose down -v

# 2. Stop the local Stellar node
echo "Stopping Stellar node..."
docker stop stellar-local 2>/dev/null || true
docker rm stellar-local 2>/dev/null || true

# 3. Clear Stellar CLI state
echo "Clearing Stellar CLI state..."
rm -rf ~/.stellar/keys 2>/dev/null || true
rm -rf ~/.stellar/identities 2>/dev/null || true

# 4. Remove compiled artifacts
echo "Cleaning contract build artifacts..."
cd contracts/vault
cargo clean
cd ../..

# 5. Remove database files
echo "Removing database files..."
rm -f backend/vaultdao.sqlite

# 6. Remove node_modules (optional, comment out to keep)
# echo "Removing node_modules..."
# rm -rf backend/node_modules frontend/node_modules

echo ""
echo "=== Reset Complete ==="
echo ""
echo "Next steps:"
echo "  1. docker compose up (start backend + frontend)"
echo "  2. Start Stellar node (Section 4)"
echo "  3. Deploy contract (Section 6)"
echo "  4. Update .env files with new contract ID"
```

### After Reset, Follow These Steps:

1. Start the Stellar node → [Section 4](#4-local-stellar-network-setup)
2. Start the Docker stack → `docker compose up`
3. Deploy the contract → [Section 6](#6-contract-deployment-to-local-network)
4. Update `.env` files with the new contract ID
5. Reset Freighter connection → [Section 7](#7-freighter-wallet--custom-network-configuration)
6. Verify everything works → [Section 5, Step 4](#step-4-verify-all-services-are-running)

---

## 12. Quick Reference Cards

### Daily Development Workflow

```bash
# 1. Start the Stellar node (keep this terminal open)
docker run --rm -it -p 8000:8000 --name stellar-local \
  stellar/quickstart:soroban-dev --local --enable-soroban-rpc

# 2. In another terminal, start the stack
docker compose up

# 3. Open the app
open http://localhost:5173
```

### Command Cheat Sheet

| Action | Command |
|--------|---------|
| **Start full stack** | `docker compose up` |
| **Start in background** | `docker compose up -d` |
| **Stop stack** | `docker compose down` |
| **Stop + delete data** | `docker compose down -v` |
| **Rebuild images** | `docker compose up --build` |
| **View logs** | `docker compose logs -f` |
| **View backend logs** | `docker compose logs -f backend` |
| **View frontend logs** | `docker compose logs -f frontend` |
| **Start Stellar node** | See Section 4 |
| **Build contract** | `cd contracts/vault && cargo build --target wasm32-unknown-unknown --release` |
| **Run contract tests** | `cd contracts/vault && cargo test` |
| **Deploy contract** | See Section 6 |
| **Install backend deps** | `cd backend && npm install` |
| **Run backend tests** | `cd backend && npm test` |
| **Install frontend deps** | `cd frontend && npm install` |
| **Run frontend tests** | `cd frontend && npm test` |

### File Locations

| File | Purpose |
|------|---------|
| `backend/.env.example` | Backend environment template |
| `frontend/.env.example` | Frontend environment template |
| `docker-compose.yml` | Service orchestration |
| `contracts/vault/Cargo.toml` | Contract dependencies |
| `backend/Dockerfile` | Backend container definition |
| `frontend/Dockerfile` | Frontend container definition |

---

> **Last updated:** 2026-07-28
>
> **Questions?** Open an issue at [github.com/NovaGrids/VaultDAO/issues](https://github.com/NovaGrids/VaultDAO/issues)
