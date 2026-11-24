# Example trace: indexer → projection (issue #2073)

OpenTelemetry traces correlate the full ingestion path. Trace context is
propagated from the event stream through normalization into the projection
write.

```
trace 4bf92f3577b34da6a3ce929d0e0e4736  (indexer → projection)
│
├─ span events.stream.subscribe          [module: events/streaming-indexer]
│    attributes:
│      rpc.provider = primary
│      stream.start_ledger = 1042000
│
├─ span events.batch.fetch               [module: events/streaming-indexer]
│    attributes: rpc.request.ledgers = 200
│    │
│    └─ span rpc.getEvents               [module: shared/rpc/soroban-rpc.client]
│         attributes: rpc.method = getEvents, rpc.duration_ms = 184
│
├─ span events.event.normalize           [module: events/normalizers]  (per event)
│    attributes: event.type = proposal_executed, event.id = 1042000-3-2
│
└─ span events.projection.write          [module: events/events.service]
     attributes: projection.type = proposals, projection.records = 12
     │
     └─ span db.insert                    [module: shared/storage]
          attributes: db.system = sqlite, db.operation = INSERT
```

Every span shares `trace_id`, so a slow `rpc.getEvents` or `db.insert` can be
attributed to the exact indexer batch in Grafana Tempo/Jaeger. The `trace_id`
and `span_id` are also attached to structured log lines via the request-context
middleware, enabling log↔trace correlation during an
`EventProcessingLagHigh` alert (see `docs/reference/RUNBOOK_ALERTS.md`).
