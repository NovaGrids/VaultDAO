# Streaming Event Indexer

`StreamingEventIndexer` (`backend/src/modules/events/streaming-indexer.ts`) indexes
Soroban contract events with an RPC stream as the primary source and paginated
`getEvents` as an automatic fallback. Polling alone burns RPC quota and adds lag;
streaming alone is fragile. The indexer combines the two.

## Modes

| Mode     | Source                                   | Leaves the mode when                                    |
|----------|------------------------------------------|---------------------------------------------------------|
| `stream` | `EventStreamSource.subscribe()` (push)   | stall (no event/heartbeat for `stallTimeoutMs`), error, or close |
| `poll`   | `getEvents` pages from the highest ledger seen | stream retry (every `streamRetryIntervalMs`) reconnects |

- On startup the indexer prefers `stream` when a stream source is configured and
  `INDEXER_STREAM_ENABLED` is not `false`. Without a source it runs in `poll`
  mode only (`reason=stream_unavailable`).
- A failed reconnect while polling keeps polling running and retries later.
- Events pushed while a subscription is still being set up are buffered and
  delivered once it becomes active. Callbacks from old subscriptions are ignored.

## Deduplication

Every event, whichever mode delivered it, goes through one bounded dedupe window
keyed by `(ledger, event_id)`. Both modes resume from the **highest ledger seen,
inclusive**. If the stream drops partway through a ledger (or a poll page fails
partway through), the rest of that ledger is fetched again and events already
projected are skipped. So switching back and forth between stream and poll never
creates duplicate projections and never skips events.

Sink (projection) calls are serialised in delivery order.

## Adaptive page size

- A rate-limited page (HTTP 429, or an error message containing "rate limit" /
  "too many requests") halves the page size, down to `INDEXER_PAGE_SIZE_MIN`.
  The next cycle then waits `INDEXER_RATE_LIMIT_BACKOFF_MS`.
- After `INDEXER_PAGE_GROW_AFTER` successful pages in a row, the page size
  doubles, up to `INDEXER_PAGE_SIZE_MAX`.

## Observability

Logs (`streaming-indexer` logger): every mode switch is logged at `info` as
`indexer mode switch` with `from`, `to`, `reason` and `highestLedger`. Stalls,
disconnects, failed subscribes and rate limits are logged at `warn`.

Metrics:

| Metric | Type | Labels |
|--------|------|--------|
| `vaultdao_indexer_mode` | gauge (1 = active) | `mode` = `stream` \| `poll` |
| `vaultdao_indexer_mode_switch_total` | counter | `from`, `to`, `reason` |
| `vaultdao_indexer_duplicates_skipped_total` | counter | `mode` |
| `vaultdao_indexer_rate_limited_total` | counter | — |
| `vaultdao_indexer_page_size` | gauge | — |

Switch reasons: `startup`, `stream_unavailable`, `stream_stall`,
`stream_disconnect`, `stream_error`, `stream_recovered`, `stopped`.

## Config knobs

Read with `loadStreamingIndexerConfig()`. Every value is a positive integer
unless noted otherwise.

| Env var | Default | Meaning |
|---------|---------|---------|
| `INDEXER_STREAM_ENABLED` | `true` | Set to `false` to force poll mode |
| `INDEXER_STREAM_STALL_TIMEOUT_MS` | `30000` | Time without an event or heartbeat before the stream counts as stalled |
| `INDEXER_STREAM_RETRY_INTERVAL_MS` | `60000` | How often poll mode tries to reconnect the stream |
| `INDEXER_POLL_INTERVAL_MS` | `10000` | Delay between poll cycles |
| `INDEXER_PAGE_SIZE_INITIAL` | `200` | Starting `getEvents` page size |
| `INDEXER_PAGE_SIZE_MIN` | `10` | Lower bound for the adaptive page size |
| `INDEXER_PAGE_SIZE_MAX` | `1000` | Upper bound (must be ≥ min) |
| `INDEXER_PAGE_GROW_AFTER` | `5` | Successful pages in a row before the page size doubles |
| `INDEXER_RATE_LIMIT_BACKOFF_MS` | `2000` | Delay after a rate-limited page |
| `INDEXER_DEDUPE_WINDOW` | `10000` | Number of `(ledger, event_id)` keys kept for dedupe |

## Wiring

```ts
const indexer = new StreamingEventIndexer({
  contractIds: [env.contractId],
  pageSource: new SorobanRpcClient({ url: env.sorobanRpcUrl }),
  streamSource: myProviderStream, // optional; omit when the RPC has no push API
  startLedger: (await cursorStorage.getCursor())?.lastLedger ?? latestLedger,
  sink: (event) => projector.apply(event),
  config: loadStreamingIndexerConfig(),
  metrics,
});
await indexer.start();
```

`EventStreamSource` is a small interface (`subscribe(params, handlers)` returning
`{ close() }`). It can wrap whatever push channel the RPC provider offers, such
as a WebSocket or SSE subscription.

## Tests

`streaming-indexer.test.ts` covers: a stream drop partway through a page with an
RPC failure during pagination (integration scenario), repeated stream↔poll
switching with no duplicate projections, stall detection, failed reconnects,
adaptive page sizing under 429s, and config parsing.
