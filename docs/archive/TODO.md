# TODO

## Step 1 — Explore & confirm source-of-truth files

- [x] Read contract event definitions: `contracts/vault/src/events.rs`
- [x] Read normalized event types/interfaces: `backend/src/modules/events/types.ts`
- [x] Read event polling/broadcast pipeline: `backend/src/modules/events/events.service.ts`
- [x] Read WS topic format & protocol: `backend/src/modules/realtime/subscriptions/topics.ts`, `backend/src/modules/realtime/realtime-server.ts`

## Step 2 — Verify TS payload interfaces cover all normalized event types

- [ ] Check that every `EventType` has a corresponding `*Data` interface used by normalizers
- [ ] Add/align any missing interfaces/fields so they match normalizer output

## Step 3 — Locate SSE subscription implementation (Issue #102)

- [ ] Search backend for SSE endpoint(s) and event envelope format
- [ ] Extract endpoint + query params + message structure for docs

## Step 4 — Write documentation

- [x] Create `docs/reference/EVENTS.md` (>= 2500 words)
  - [x] Contract events section: every event in `events.rs` (field-by-field)
  - [x] Normalized payload schemas: TS interfaces for every event type
  - [x] WebSocket subscription guide: handshake, topics, subscribe/unsubscribe, reconnection
  - [ ] SSE subscription guide: endpoint/query params/event format (Issue #102)
  - [x] Event lifecycle diagram (Mermaid) render on GitHub
  - [x] At least 1 additional Mermaid diagram
  - [x] Rate limits & filtering recommendations
- [x] Create `docs/reference/STORAGE.md` (>= 2000 words)
  - [x] Storage decision tree (Mermaid flowchart)
  - [x] TTL mechanics + storage-type rules
  - [x] Cost model + examples (parametric; fee constants to be filled with current Stellar params)
  - [x] Storage key design patterns
  - [x] VaultDAO storage inventory (all storage keys in `contracts/vault/src/storage.rs`)
  - [ ] Cost estimates updated with current Stellar fee parameters (cite version)

## Step 5 — Validation

- [ ] Run backend typecheck/tests/lint
- [ ] Ensure docs file(s) are present and Mermaid syntax is GitHub-compatible
