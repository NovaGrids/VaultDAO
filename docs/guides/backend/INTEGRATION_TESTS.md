# Backend Integration Tests

This document covers the backend integration tests that verify interactions with Redis, SQLite, and the full event processing pipeline.

## Overview

The integration tests validate:
- Redis connection and operations
- SQLite database operations
- Event processing end-to-end
- Webhook delivery and retry logic
- Multi-service workflows
- Error handling and recovery

## Prerequisites

### Local Development
```bash
cd backend
npm install
```

### Docker Compose (Recommended for full testing)
```bash
docker compose up
```

This starts:
- Redis (cache and event queue)
- SQLite (local database)
- Backend service (with hot-reload)

## Running Integration Tests

### All Tests
```bash
npm test
```

### Specific Test Suite
```bash
npm test -- src/integration.test.ts
```

### With Coverage
```bash
npm test -- --coverage
```

### Watch Mode
```bash
npm run dev
```

## Test Coverage

### 1. Redis Connection Tests
- Connection establishment
- Ping verification
- Connection pooling
- Error recovery

### 2. Redis Operations
- Key-value storage and retrieval
- Expiration handling
- List operations (push, pop, range)
- Hash operations for counters

### 3. SQLite Database Tests
- Table creation
- Record insertion
- Query execution
- Concurrent operations
- Transaction handling

### 4. Event Processing
- Event arrival and storage
- Event processing pipeline
- Event state tracking
- Cursor management

### 5. Approval Events
- Approval event handling
- Vote aggregation
- State updates

### 6. Webhook Delivery
- Queue operations
- Retry logic (up to 3 attempts)
- Dead letter queue handling
- Batch delivery

### 7. Multi-Service Workflow
- Full event → process → webhook flow
- High-throughput event processing (100+ events)
- State consistency across services

### 8. Error Handling
- Redis connection errors
- Invalid event data
- Webhook timeout handling
- Recovery mechanisms

## Test Architecture

```
┌─────────────────────────────────────┐
│  Integration Tests                  │
├─────────────────────────────────────┤
│ ┌──────────────┐                    │
│ │ Redis Tests  │ → Redis Service    │
│ └──────────────┘                    │
│ ┌──────────────┐                    │
│ │ SQLite Tests │ → SQLite Database  │
│ └──────────────┘                    │
│ ┌──────────────────┐                │
│ │ Event Processing │ → Pipeline     │
│ └──────────────────┘                │
│ ┌──────────────────┐                │
│ │ Webhook Delivery │ → HTTP Calls   │
│ └──────────────────┘                │
│ ┌──────────────────┐                │
│ │ Error Handling   │ → Fallbacks    │
│ └──────────────────┘                │
└─────────────────────────────────────┘
```

## Docker Compose Workflow

### Start Services
```bash
docker compose up -d
```

### Run Tests Against Services
```bash
REDIS_HOST=localhost REDIS_PORT=6379 npm test
```

### View Logs
```bash
docker compose logs -f backend
docker compose logs -f redis
```

### Stop Services
```bash
docker compose down
```

## Environment Configuration

For local development without Docker, create `.env`:
```
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_PATH=./vaultdao.sqlite
NODE_ENV=test
```

For Docker Compose environment:
```
REDIS_HOST=redis
REDIS_PORT=6379
DATABASE_PATH=/app/data/vaultdao.sqlite
```

## Event Flow Testing

The integration tests trace this flow:

```
1. Event Published
   └─ Event arrives from blockchain

2. Cached in Redis
   └─ event:workflow:{id} stored with TTL

3. Processing
   └─ Event parsed and validated
   └─ Database updated (if SQLite enabled)

4. Webhook Queue
   └─ webhook:{event_type} added to queue

5. Delivery
   └─ Webhook sent to configured URL
   └─ Retry on failure (up to 3x)
   └─ Dead letter queue on max retries

6. State Update
   └─ Cursor advanced
   └─ Event marked processed
```

## Performance Metrics

Test suite evaluates:
- Event processing latency (< 100ms expected)
- Webhook delivery throughput (100+ events/sec)
- Redis operation performance (< 10ms)
- Memory usage (< 100MB for test suite)
- Connection pool efficiency

## Troubleshooting

### Redis Connection Refused
```bash
# Check if Redis is running
docker compose ps

# Restart Redis
docker compose restart redis
```

### SQLite Database Locked
```bash
# Remove locked database and restart
rm vaultdao.sqlite
npm test
```

### Tests Timeout
```bash
# Increase test timeout
NODE_TEST_TIMEOUT=60000 npm test
```

### Network Issues with Docker
```bash
# Verify network is created
docker network ls

# Recreate network
docker compose down
docker compose up --force-recreate
```

## Success Criteria

✓ All Redis operations complete within 100ms
✓ SQLite concurrent operations don't deadlock
✓ Event processing completes in order
✓ Webhooks retry on transient failures
✓ Dead letter queue captures permanent failures
✓ 100 events processed without errors
✓ Multi-service workflow completes end-to-end
✓ Error cases handled gracefully

## Continuous Integration

The test suite is designed to run in CI/CD pipelines:

```yaml
test:
  runs-on: ubuntu-latest
  services:
    redis:
      image: redis:7-alpine
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
    - run: npm install
    - run: npm test
```

## Maintenance

- Review tests quarterly for new code paths
- Update timeout values based on deployment performance
- Add tests for new webhook event types
- Monitor flaky tests and fix root causes
