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
| `ADMIN_KEY_SECRET_ID` | `vaultdao/staging/admin-key` | `vaultdao/prod/admin-key` | Secrets Manager secret holding the admin contract key reference |
| `AWS_REGION` | `us-east-1` | `us-east-1` | Region of the KMS CMK and admin secret |
| `ADMIN_KEY_KMS_KEY_ID` | CMK alias/ARN | CMK alias/ARN | KMS CMK used to encrypt/decrypt the admin key |
| `ADMIN_KEY_FETCH_ON_BOOT` | `true` | `true` | Fetch admin key from Secrets Manager at startup |
=======

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
✅ [ ] Admin key sourced from Secrets Manager (not env vars)
✅ [ ] Backend IAM role limited to GetSecretValue + kms:Decrypt
✅ [ ] DB backups (daily)
✅ [ ] Metrics alerting (sync lag > 5min)
```

## 🔐 **Admin Contract Key Management (AWS KMS)**

The admin keypair that signs contract upgrade transactions is **never** stored in environment variables or baked into images. It is managed by the `terraform/modules/kms/` module, which provisions:

- **AWS KMS CMK** — a customer-managed key (alias `alias/vaultdao-<env>-admin`) used to encrypt/decrypt the admin key material. Key policy grants `kms:Decrypt`/`kms:Encrypt`/`kms:GenerateDataKey` only to the backend task role and the rotation operator role.
- **AWS Secrets Manager secret** — `vaultdao/<env>/admin-key`, encrypted with the CMK above. The secret payload holds the admin key *reference* (e.g. `{"adminPublicKey": "G...", "keyRef": "kms:vaultdao-<env>-admin", "version": 1}`), not raw key material in plaintext config.

### Startup Secret Fetch

The backend module ships a startup script (`scripts/fetch-admin-key.sh`) that runs before the Node.js process boots:

```bash
#!/usr/bin/env bash
set -euo pipefail

SECRET_ID="${ADMIN_KEY_SECRET_ID:?ADMIN_KEY_SECRET_ID is required}"
REGION="${AWS_REGION:-us-east-1}"

# Fetch the secret (decrypted via the KMS CMK) using the AWS CLI
SECRET_JSON="$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text)"

# Export the admin key reference for the backend process
export ADMIN_KEY_REF="$(echo "$SECRET_JSON" | jq -r '.keyRef')"
export ADMIN_PUBLIC_KEY="$(echo "$SECRET_JSON" | jq -r '.adminPublicKey')"
export ADMIN_KEY_VERSION="$(echo "$SECRET_JSON" | jq -r '.version')"

exec node dist/index.js
```

The equivalent SDK call (`@aws-sdk/client-secrets-manager`) is used when the script runs inside the container:

```js
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
const { SecretString } = await client.send(
  new GetSecretValueCommand({ SecretId: process.env.ADMIN_KEY_SECRET_ID })
);
const { keyRef, adminPublicKey, version } = JSON.parse(SecretString);
process.env.ADMIN_KEY_REF = keyRef;
process.env.ADMIN_PUBLIC_KEY = adminPublicKey;
process.env.ADMIN_KEY_VERSION = String(version);
```

If the fetch fails, the script exits non-zero so the orchestrator does not start a backend without a valid admin key reference.

### Required IAM Permissions

Attach the following least-privilege policy to the backend task/instance role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "arn:aws:secretsmanager:<region>:<account>:secret:vaultdao/<env>/admin-key-*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:<region>:<account>:key/<cmk-id>"
    }
  ]
}
```

The rotation operator role additionally needs `secretsmanager:PutSecretValue`, `secretsmanager:UpdateSecretVersionStage`, and `kms:Encrypt`/`kms:GenerateDataKey` on the CMK.

### Key Rotation Procedure

1. **Create a new key version** — generate the new admin keypair and store it as a new secret version (do not delete the old version yet):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id vaultdao/prod/admin-key \
     --secret-string '{"adminPublicKey":"G<NEW>","keyRef":"kms:vaultdao-prod-admin","version":2}'
   ```
2. **Update the secret stage** — move `AWSCURRENT` to the new version so new fetches pick it up:
   ```bash
   aws secretsmanager update-secret-version-stage \
     --secret-id vaultdao/prod/admin-key \
     --version-stage AWSCURRENT \
     --move-to-version-id <new-version-id> \
     --remove-from-version-id <old-version-id>
   ```
3. **Redeploy the backend** — roll the deployment so the startup script re-fetches the secret and exports the new `ADMIN_KEY_REF`/`ADMIN_PUBLIC_KEY`:
   ```bash
   kubectl rollout restart deployment/vaultdao-backend   # or: docker compose up -d --force-recreate backend
   ```
4. **Verify** — confirm `/ready` reports the new `ADMIN_KEY_VERSION` and that upgrade transactions sign with the new key.
5. **Revoke the old key** — after the grace period, disable/destroy the previous secret version and, if the old key was registered on-chain, rotate the admin role on the contract to the new public key:
   ```bash
   aws secretsmanager update-secret-version-stage \
     --secret-id vaultdao/prod/admin-key \
     --version-stage AWSPREVIOUS \
     --remove-from-version-id <old-version-id>
   ```

Rotate admin keys at least quarterly, and immediately on suspected compromise.

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
