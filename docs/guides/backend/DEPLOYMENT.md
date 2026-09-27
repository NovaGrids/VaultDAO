# VaultDAO Backend Deployment Guide

## 🎯 **Overview**
Lightweight Node.js service for indexing, realtime, and notifications. **Stateless, horizontal scaling friendly**.

## ☁️ **Deployment Models**

### 1. **Local Orchestration (Docker Compose - Recommended for Dev)**
This spins up both the React `frontend` and Node.js `backend` services inside a shared custom network with hot-reloading and automatic environment variable fallbacks.

```bash
# Start both services in development mode with live hot-reloading
docker compose up

# Build containers from scratch and start the stack
docker compose up --build

# Start the services in detached (background) mode
docker compose up -d

# Check orchestration container statuses
docker compose ps

# Follow logs from both services
docker compose logs -f

# Stop and clean up containers, volumes, and network resources
docker compose down
```

### 2. **Production Docker Container**
We leverage an optimized two-stage Docker build that isolates production assets, discards development dependencies, and runs as a non-root `node` user for security compliance.

```bash
# Build the highly optimized production image from the repository root
docker build -t vaultdao-backend:latest ./backend

# Run the production container mapping host port 8787
docker run -d \
  --name vaultdao-backend \
  --env-file ./backend/.env \
  -p 8787:8787 \
  --restart unless-stopped \
  vaultdao-backend:latest
```

### 3. **Image Footprint Verification**
To ensure the container remains lightweight and fits under target constraints:

```bash
# Check size of the built image (Target: strictly < 200MB)
docker images vaultdao-backend

# Analyze container layers and their respective weights
docker history vaultdao-backend
```

### 2. **Railway/Render/Fly.io**
```
# Railway (e.g.)
railway up --docker
# or connect GitHub repo directly
```

### 3. **Kubernetes**
```yaml
# Minimal Deployment + Service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vaultdao-backend
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: backend
        image: vaultdao-backend:latest
        envFrom:
        - secretRef:
            name: backend-secrets
        ports:
        - containerPort: 8787
        resources:
          limits:
            cpu: "500m"
            memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  ports:
  - port: 8787
    targetPort: 8787
  selector:
    app: vaultdao-backend
```

### 4. **VPS/Traditional Server**
```
# PM2 (recommended)
npm i -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# systemd
cp backend.service /etc/systemd/system/
systemctl enable vaultdao-backend
systemctl start vaultdao-backend
```

## 🔧 **Environment Requirements**

| Variable | Staging | Production | Description |
|----------|---------|------------|-------------|
| `NODE_ENV` | `staging` | `production` | Runtime mode |
| `PORT` | `8787` | `8787` | HTTP port |
| `SOROBAN_RPC_URL` | Testnet RPC | Mainnet RPC | Contract queries |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` | Account/ledger data |
| `CONTRACT_ID` | Testnet contract | Mainnet contract | Target VaultDAO |
| `DATABASE_URL` | `sqlite://data.db` | `postgres://...` | Persistence (Prisma format) |
| `REDIS_URL` | `redis://localhost:6379` | `rediss://...` | Caching/pubsub |
| `LOG_LEVEL` | `info` | `warn` | Structured logging |

**.env.prod template**:
```
NODE_ENV=production
PORT=8787
SOROBAN_RPC_URL=https://soroban-api.stellar.org
HORIZON_URL=https://horizon.stellar.org
CONTRACT_ID=<your-mainnet-contract>
DATABASE_URL=postgresql://user:pass@host:5432/vaultdao
REDIS_URL=rediss://username:password@host:6380/0
LOG_LEVEL=warn
```

## ⚙️ **Process Model**

```
Inbound Events → Event Processor → Storage → Aggregators → API/Cache
                          ↓
                   Realtime (WS) ← Subscriptions ← Redis Pub/Sub
                          ↓
                    Scheduled Jobs (BullMQ) → Keepers → RPC Calls
```

**Scaling Strategy**:
```
1. Single instance: dev/staging (SQLite + in-memory)
2. 2-3 replicas: small prod (Postgres + Redis)
3. Horizontal: large prod (add replicas, Redis cluster)
```

## 📊 **Resource Expectations**

| Tier | CPU | RAM | Storage | DB |
|------|-----|-----|---------|----|
| Dev | 100m | 256Mi | 1GB | SQLite |
| Staging | 250m | 512Mi | 10GB | Postgres (1 vCPU) |
| Production (1k tx/day) | 500m | 1Gi | 50GB | Postgres (2 vCPU) |
| Production (10k tx/day) | 2 x 1Gi | 2Gi ea | 200GB | Postgres (4 vCPU) + Redis |

## 🔍 **Monitoring & Logging**

**Structured JSON logs** (Pino):
```
{"level":30,"time":1735689600,"pid":1,"hostname":"deploy-1","req":{"id":"abc123"},"msg":"proposal indexed"}
```

**Key Metrics** (Prometheus `/metrics`):
- `backend_sync_lag_seconds`
- `backend_db_connections`
- `backend_ws_connections_active`
- `backend_jobs_failed_total`
- `backend_events_processed_total`

**Health Checks**:
```
GET /health          # Liveness (up/down)
GET /ready           # Readiness (DB/Wallet connected)  
GET /api/v1/status   # Business health (sync lag, queue depth)
```

## 🌐 **Public Endpoints**

| Endpoint | Auth | Rate Limit | Purpose |
|----------|------|------------|---------|
| `/health` | None | None | Liveness probe |
| `/ready` | None | None | Readiness probe |
| `/api/v1/proposals` | API Key | 100/min | Paginated proposals |
| `/api/v1/proposals/{id}` | API Key | 100/min | Single proposal |
| `/ws` | Token | Conn limit | Realtime subscriptions |
| `/metrics` | None | None | Prometheus metrics |

**CORS**: `https://your-frontend.com` (configurable)

## 🚀 **Production Checklist**

```
✅ [ ] Set NODE_ENV=production
✅ [ ] CONTRACT_ID=mainnet contract
✅ [ ] DATABASE_URL=Postgres (not SQLite)
✅ [ ] REDIS_URL=external Redis  
✅ [ ] LOG_LEVEL=warn (not debug)
✅ [ ] PM2/systemd supervisor
✅ [ ] Health checks wired to orchestrator
✅ [ ] API keys rotated monthly
✅ [ ] DB backups (daily)
✅ [ ] Metrics alerting (sync lag > 5min)
```

## 🛠️ **Zero-Downtime Updates**

```
# Blue-green with Docker
docker pull vaultdao-backend:new
docker run --detach ... vaultdao-backend:new  # Traffic switch
docker stop vaultdao-backend:old
docker rm vaultdao-backend:old
docker tag vaultdao-backend:new vaultdao-backend:latest
```

**Updated: YYYY-MM-DD** | Questions? Open issue labeled `deployment`.
