# VaultDAO Backend Roadmap & Contributor Checklist

## 🎯 **Mission**
Lightweight support service for VaultDAO. Indexes events, realtime subscriptions, scheduled jobs, notifications. **Does NOT replace Soroban contract**.

## 📊 **Workstreams** (Prioritized)

### 1. **🔥 Foundation (Week 1-2)**
Core persistence & indexing infrastructure.

| Task | Status | Est. Effort | Contributor Type |
|------|--------|-------------|------------------|
| [ ] **SQLite Schema** (`src/shared/storage/schema.sql`)<br>Migrate to Prisma/SQLite: proposals, recurring, tags, snapshots | New | 1 day | Junior |
| [ ] **Persistent Events Cursor** (`src/modules/events/cursor/sqlite.adapter.ts`)<br>Replace file-cursor with DB storage | Scaffold exists | 4h | Junior |
| [ ] **Event Replay CLI** (`src/modules/events/replay`)<br>Full historical sync from ledger 0 | Scaffold exists | 1 day | Intermediate |
| [ ] **Health Dashboard** (`/api/v1/health`)<br>DB connection, sync lag, queue depth metrics | Scaffold exists | 4h | Junior |

### 2. **⚡ Indexing (Week 2-3)**
Real-time event processing pipeline.

| Task | Status | Est. Effort | Contributor Type |
|------|--------|-------------|------------------|
| [ ] **Soroban RPC Streaming** (`src/modules/events/streamer.ts`)<br>Subscribe to contract events via RPC `stream` | Planned | 2 days | Intermediate |
| [ ] **Proposal Aggregator** (`src/modules/proposals/aggregator.ts`)<br>Real-time status (pending/approved/executed counts) | Scaffold exists | 1 day | Junior |
| [ ] **Snapshot Service** (`src/modules/snapshots`)<br>Generate vault snapshots every 100 ledgers | Scaffold exists | 1 day | Intermediate |
| [ ] **Tag Index** (`src/modules/tags/indexer.ts`)<br>Fast lookup by proposal tags | New | 4h | Junior |

### 3. **🕹️ Realtime (Week 3-4)**
WebSocket subscriptions and pub/sub.

| Task | Status | Est. Effort | Contributor Type |
|------|--------|-------------|------------------|
| [ ] **Subscription Topics** (`src/modules/realtime/topics.ts`)<br>Proposal updates, new tags, execution events | Scaffold exists | 4h | Junior |
| [ ] **Redis Pub/Sub** (`src/modules/realtime/redis.adapter.ts`)<br>Scale subscriptions horizontally | Planned | 1 day | Advanced |
| [ ] **GraphQL Subscriptions** (`/graphql`)<br>Typed realtime queries | Planned | 3 days | Advanced |

### 4. **⚙️ Jobs & Keepers (Week 4-5)**
Scheduled and recurring background work.

| Task | Status | Est. Effort | Contributor Type |
|------|--------|-------------|------------------|
| [ ] **Recurring Payment Keeper** (`src/modules/jobs/recurring/due-payments.job.ts`)<br>Check & execute due payments every 5min | Scaffold exists | 1 day | Junior |
| [ ] **Cursor Cleanup** (`src/modules/jobs/recurring/cursor-cleanup.job.ts`)<br>Prune old events | Scaffold exists | 2h | Junior |
| [ ] **Retry Queue** (`src/modules/jobs/retry.manager.ts`)<br>Failed keeper jobs | Planned | 1 day | Intermediate |
| [ ] **BullMQ Integration** (`src/modules/jobs/bullmq.adapter.ts`)<br>Production-grade job queue | Planned | 2 days | Advanced |

### 5. **🔔 Notifications (Week 5+)**
Alerts and webhooks.

| Task | Status | Est. Effort | Contributor Type |
|------|--------|-------------|------------------|
| [ ] **Proposal Threshold Alerts** (`src/modules/notifications/thresholds.ts`)<br>Email/SMS when threshold reached | Planned | 1 day | Junior |
| [ ] **Execution Webhooks** (`src/modules/notifications/webhooks.ts`)<br>POST to configured URLs | Planned | 1 day | Intermediate |
| [ ] **Telegram/Discord Bots** (`src/modules/notifications/bots.ts`)<br>Rich notifications | Planned | 2 days | Intermediate |

## 🚀 **New Contributor Quickstart**

```
# 1. Clone & Install
git clone <repo> && cd backend && pnpm install

# 2. Copy env
cp .env.example .env
# Edit CONTRACT_ID, SOROBAN_RPC_URL for your network

# 3. Foundation Tasks (pick one)
pnpm test # Verify scaffold
# Then pick from Foundation section above

# 4. Test & PR
pnpm test
pnpm typecheck
git push origin feature/your-task
```

## 📈 **Advanced / Stretch Goals**

- **Postgres Adapter** (`src/shared/storage/postgres.adapter.ts`)
- **Prometheus Metrics** (`/metrics`)
- **GraphQL API** (`/graphql`)
- **Multi-Contract Support**
- **Event Archiving** (S3)

## 🎯 **Success Metrics**

```
✅ Backend indexes 100% of events in < 30s lag
✅ 1000 concurrent WS subscriptions with < 100ms latency  
✅ 99.9% keeper uptime (no missed recurring payments)
✅ < 5s p99 query latency at 1M proposals
```

**Updated: YYYY-MM-DD** | **Next Sprint Focus**: Foundation → Indexing
