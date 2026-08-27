# VaultDAO Enterprise Integration Checklist

**Document type:** Go-live / integration sign-off  
**Applies to:** Production and production-like staging vaults  
**References:** `contracts/vault`, `frontend`, `backend`, `sdk`, `docs/reference/DEPLOYMENT.md`, `docs/reference/PRODUCTION_RUNBOOK.md`, `docs/guides/TREASURY_RISK_MANAGEMENT.md`

This checklist replaces the prior developer gap-analysis format. It is an **enterprise sign-off** artifact: every item has a description, a verification method, an accountable role, and a checkbox. Complete phases in order. Do not declare production Go until the [Go/No-Go decision matrix](#go--no-go-decision-matrix) is entirely Go (or formally waived with Security Officer approval).

**Roles**

| Role | Accountability |
| ---- | -------------- |
| **Admin** | On-chain configuration, signers, roles, pause/unpause, limit changes |
| **Treasurer** | Proposal workflows, spending policy fit, recurring schedules, day-2 treasury ops |
| **DevOps** | Deployments, RPC, keepers, webhooks, monitoring, secrets, uptime |
| **Security Officer** | Threat review, breaker thresholds, emergency contacts, final security sign-off |

Legend: ☐ = incomplete · ☑ = complete (mark in your copy when verified)

---

## Phase 1 — Pre-Deployment

### 1.1 Business and policy readiness

- [ ] **Board / charter approval for VaultDAO custody model**  
  **Description:** Confirm legal/ops authority to hold treasury in a Soroban multi-sig vault with timelocks and spending limits.  
  **How to verify:** Signed board minute or policy exhibit attached to this checklist packet.  
  **Who:** Admin

- [ ] **Spending policy drafted (limits as % of treasury)**  
  **Description:** Document target `spending_limit`, `daily_limit`, `weekly_limit`, and per-token caps. Treat published percentage bands as guidelines until the board adopts them as mandates.  
  **How to verify:** Policy doc exists; absolute amounts computed for current balances (see Treasury Risk Management calculator).  
  **Who:** Treasurer

- [ ] **Signer roster and role matrix finalized**  
  **Description:** Named humans ↔ Stellar addresses ↔ roles (`Admin`, `Treasurer`, `Member`) ↔ backup coverage.  
  **How to verify:** Roster spreadsheet matches intended on-chain signers; at least one backup Admin path documented.  
  **Who:** Admin

- [ ] **Delegation policy agreed**  
  **Description:** When voting power may be delegated, max duration, and revocation SLA.  
  **How to verify:** Written policy; Security Officer acknowledges.  
  **Who:** Admin

### 1.2 Multi-token readiness

- [ ] **Supported token list approved**  
  **Description:** Enumerate SAC/token contract addresses for `Config.supported_tokens` (max per contract rules; first entry is default and non-removable).  
  **How to verify:** Token addresses verified on the target network explorer; decimals and issuer documented.  
  **Who:** Treasurer

- [ ] **Per-token daily/weekly limits designed**  
  **Description:** Map `token_daily_limits` / `token_weekly_limits` to each supported asset’s liquid balance policy.  
  **How to verify:** Table of token → daily → weekly reviewed by Treasurer and Admin.  
  **Who:** Treasurer

- [ ] **Trustlines / contract allowances planned**  
  **Description:** Ensure the vault account can hold and transfer each asset (trustlines, SAC setup, funding plan).  
  **How to verify:** Testnet rehearsal successfully transfers each token through a proposal path.  
  **Who:** DevOps

### 1.3 Compliance baseline

- [ ] **Compliance baseline defined**  
  **Description:** Target Governance Health **compliance score** band (recommend sustain ≥ 80 / green `% Compliant`), attachment verification rules, and audit export cadence.  
  **How to verify:** Baseline written; monitoring will alert below threshold (e.g., < 50 red).  
  **Who:** Treasurer

- [ ] **Recipient policy chosen**  
  **Description:** Decide whitelist mode (`whitelist_mode`) and initial allow/deny lists if used.  
  **How to verify:** Policy + initial address lists attached; Testnet enforcement observed.  
  **Who:** Admin

- [ ] **Audit / reporting requirements mapped**  
  **Description:** Who receives monthly exports, webhook alerts, and evidence packs.  
  **How to verify:** Named mailbox / ticket queue; sample report generated on staging.  
  **Who:** Treasurer

### 1.4 Circuit breaker and pause design

- [ ] **`circuit_breaker_threshold` selected**  
  **Description:** Set on-chain hourly outflow threshold used by `storage::get_circuit_breaker_threshold` / execute-path pause (`cause = circuit_breaker`). `0` disables—production should not disable without waiver.  
  **How to verify:** Absolute threshold documented vs treasury %; Security Officer approves.  
  **Who:** Security Officer

- [ ] **Pause / unpause authority documented**  
  **Description:** Who may pause manually, who may unpause after breaker trip, dual-control expectations.  
  **How to verify:** Runbook section exists with names and Freighter accounts.  
  **Who:** Admin

### 1.5 Infrastructure design

- [ ] **Network and RPC topology chosen**  
  **Description:** Mainnet vs testnet; primary + fallback Soroban RPC; Horizon endpoints.  
  **How to verify:** Architecture note in deployment packet; failover tested on staging.  
  **Who:** DevOps

- [ ] **Keeper network designed**  
  **Description:** Recurring payment / expiration / due-work keepers: hosting, keys, polling cadence, backoff, alerting (see Recurring Payments guide).  
  **How to verify:** Diagram of keeper instances (≥1 redundant for production); failure Slack/Pager channel named.  
  **Who:** DevOps

- [ ] **Notification webhooks designed**  
  **Description:** Backend `/webhooks` registrations for proposal, pause, execution, and keeper failure events; signing secrets; retry/circuit-breaker behavior for outbound HTTP.  
  **How to verify:** Webhook matrix (event → URL → owner) reviewed; staging delivery proof attached.  
  **Who:** DevOps

- [ ] **Secrets management ready**  
  **Description:** No secrets in git; deployer keys, webhook HMAC secrets, IPFS credentials in vault/KMS.  
  **How to verify:** Secret inventory checklist signed by DevOps.  
  **Who:** DevOps

- [ ] **Frontend env baseline prepared**  
  **Description:** `VITE_*` contract IDs, RPC URLs, `VITE_IPFS_GATEWAY` / API, `VITE_API_BASE_URL`.  
  **How to verify:** Staging build points at staging contracts only; config review screenshots.  
  **Who:** DevOps

---

## Phase 2 — Deployment

### 2.1 Contract deployment

- [ ] **Vault WASM built from release commit**  
  **Description:** Build `contracts/vault` for `wasm32-unknown-unknown` from a tagged/commit-pinned revision.  
  **How to verify:** CI artifact hash recorded; `cargo test` green on that commit.  
  **Who:** DevOps

- [ ] **Contract deployed and initialized**  
  **Description:** Deploy and call `initialize` with signers, threshold, quorum, spending limits, timelock params, supported tokens, high-impact threshold, etc.  
  **How to verify:** Explorer shows contract; `get_config` returns expected struct fields.  
  **Who:** Admin

- [ ] **Multi-token config applied on-chain**  
  **Description:** `supported_tokens`, `token_daily_limits`, `token_weekly_limits` match the approved matrix.  
  **How to verify:** Config readback diff’d against Pre-Deployment tables.  
  **Who:** Admin

- [ ] **`circuit_breaker_threshold` set on-chain**  
  **Description:** Persist non-zero production threshold via `set_circuit_breaker_threshold` (or deployment script equivalent).  
  **How to verify:** `get_circuit_breaker_threshold` returns the approved value (not `0` unless waived).  
  **Who:** Admin

- [ ] **Roles assigned**  
  **Description:** `set_role` for Admin/Treasurer addresses per roster.  
  **How to verify:** `get_role` / dashboard Role Management matches roster.  
  **Who:** Admin

### 2.2 Application deployment

- [ ] **Backend deployed with notifications enabled**  
  **Description:** Express service live; notification routes and webhook registry reachable.  
  **How to verify:** Health endpoint OK; `GET/POST` webhooks authorized path tested.  
  **Who:** DevOps

- [ ] **Frontend deployed against production contract IDs**  
  **Description:** Dashboard build serves correct network and contract address.  
  **How to verify:** Connect Freighter on Public/Testnet as planned; config panel shows expected vault.  
  **Who:** DevOps

- [ ] **SDK consumers pointed at production**  
  **Description:** Internal scripts/bots use production RPC + contract ID.  
  **How to verify:** Dry-run read methods succeed; write methods gated.  
  **Who:** DevOps

### 2.3 Keeper network go-live

- [ ] **Keeper identities funded and restricted**  
  **Description:** Keeper keys can execute recurring/maintenance calls but are not unnecessary Admins.  
  **How to verify:** Balance sufficient; role review; key ceremony notes stored.  
  **Who:** DevOps

- [ ] **Keeper schedules active**  
  **Description:** Cron/systemd/k8s CronJobs invoking due recurring payments and any expiration jobs.  
  **How to verify:** Successful dry execution on staging clone; production logs show poll cycles.  
  **Who:** DevOps

- [ ] **Keeper alerting wired**  
  **Description:** Metrics/alerts for failed executions, backoff storms, missed payments.  
  **How to verify:** Forced failure on staging pages an on-call; runbook link in alert.  
  **Who:** DevOps

### 2.4 Notification webhooks go-live

- [ ] **Production webhooks registered**  
  **Description:** Register endpoints for pause, execution, proposal lifecycle, and critical errors.  
  **How to verify:** `list` webhooks; send test event; receiver acknowledges.  
  **Who:** DevOps

- [ ] **Webhook authenticity configured**  
  **Description:** HMAC or shared-secret validation on receiver; secrets rotated into store.  
  **How to verify:** Request with bad signature rejected; good signature accepted.  
  **Who:** DevOps

- [ ] **Outbound webhook circuit breakers understood**  
  **Description:** Backend breaker opens on repeated sink failures; ops knows how to reset.  
  **How to verify:** Runbook cites breaker reset; staging test performed.  
  **Who:** DevOps

---

## Phase 3 — Post-Deployment

### 3.1 Functional acceptance

- [ ] **Wallet connect + role badge verified**  
  **Description:** Freighter **Connect Wallet**; address and Admin/Treasurer badge correct.  
  **How to verify:** Each production signer completes a connect screenshot or attested check.  
  **Who:** Treasurer

- [ ] **End-to-end proposal on small amount**  
  **Description:** Propose → approve to threshold → timelock (if applicable) → execute.  
  **How to verify:** On-chain executed proposal; dashboard status **Executed**; funds received.  
  **Who:** Treasurer

- [ ] **Reject / cancel path verified**  
  **Description:** Ensure unwanted proposals can be stopped per contract methods exposed in UI/runbook.  
  **How to verify:** Test proposal cancelled/rejected; spending buckets behave as expected.  
  **Who:** Treasurer

- [ ] **IPFS attachment verify path checked**  
  **Description:** Upload/view attachment; status reaches **✓ Verified** (not **Integrity Failed**).  
  **How to verify:** Sample CID opens in attachment viewer with green verified badge.  
  **Who:** Treasurer

- [ ] **Spending limit enforcement proven**  
  **Description:** Intentional over-limit proposal fails with daily/weekly/per-proposal error.  
  **How to verify:** Error toast / contract error captured; no funds moved.  
  **Who:** Treasurer

- [ ] **Multi-token transfer proven**  
  **Description:** At least one non-default supported token transferred via proposal.  
  **How to verify:** Recipient balance increased; token limits decremented appropriately.  
  **Who:** Treasurer

### 3.2 Safety acceptance

- [ ] **Circuit breaker drill (staging or controlled prod micro-threshold)**  
  **Description:** Demonstrate pause when hourly outflow would exceed `circuit_breaker_threshold`.  
  **How to verify:** Pause event with cause `circuit_breaker`; `VaultPaused` on execute; recovery documented.  
  **Who:** Security Officer

- [ ] **Compliance baseline visible**  
  **Description:** Governance Health widget shows participation, active proposals, `% Compliant`.  
  **How to verify:** Screenshot after first week of activity or seeded snapshot API.  
  **Who:** Treasurer

- [ ] **Emergency controls reachable**  
  **Description:** Admin can access emergency/pause UI or documented CLI/SDK path.  
  **How to verify:** Dry-run on staging; production access ACLs confirmed.  
  **Who:** Admin

### 3.3 Operations acceptance

- [ ] **Monitoring dashboards live**  
  **Description:** RPC health, keeper metrics, webhook success rate, pause alerts.  
  **How to verify:** Dashboard URLs listed; on-call can open without shared personal logins.  
  **Who:** DevOps

- [ ] **Backup and restore of off-chain config**  
  **Description:** Webhook registry, env templates, keeper configs backed up.  
  **How to verify:** Restore test on staging within RTO target.  
  **Who:** DevOps

- [ ] **Production runbook linked**  
  **Description:** Team knows `docs/reference/PRODUCTION_RUNBOOK.md` and treasury risk guide.  
  **How to verify:** On-call quiz: where is breaker threshold, how to unpause, who to call.  
  **Who:** DevOps

---

## Phase 4 — Ongoing Operations

### 4.1 Cadence

- [ ] **Monthly risk review scheduled**  
  **Description:** Execute Treasury Risk Management monthly checklist (< 1 hour).  
  **How to verify:** Calendar series + last meeting notes attached to packet.  
  **Who:** Treasurer

- [ ] **Quarterly signer attestation**  
  **Description:** Each signer confirms Freighter address control and device hygiene.  
  **How to verify:** Signed attestation forms.  
  **Who:** Admin

- [ ] **Dependency and RPC review**  
  **Description:** Revisit RPC providers, keeper images, and contract upgrade path.  
  **How to verify:** Quarterly DevOps note filed.  
  **Who:** DevOps

### 4.2 Continuous controls

- [ ] **Compliance score watched**  
  **Description:** Sustain baseline; escalate on yellow/red bands.  
  **How to verify:** Alerts configured; last 30 days trend reviewed monthly.  
  **Who:** Treasurer

- [ ] **Temporary limit raises tracked to reset**  
  **Description:** No orphaned elevated `daily_limit` / `weekly_limit` / `spending_limit`.  
  **How to verify:** Config diff vs policy targets each month.  
  **Who:** Admin

- [ ] **Keeper SLA reviewed**  
  **Description:** Missed recurring payments within policy; backoff not masking systemic failure.  
  **How to verify:** Keeper metrics + incident tickets closed with RCA.  
  **Who:** DevOps

- [ ] **Webhook sink health reviewed**  
  **Description:** No prolonged open breaker on critical notification channels.  
  **How to verify:** Webhook delivery success rate ≥ agreed SLO.  
  **Who:** DevOps

- [ ] **Access reviews**  
  **Description:** Remove departed signers promptly; rotate secrets on role change.  
  **How to verify:** HR offboarding ticket ↔ on-chain remove_signer evidence.  
  **Who:** Admin

---

## Go / No-Go decision matrix

Mark each row **GO** or **NO-GO**. **Any NO-GO blocks production launch** unless a dated waiver is signed by Security Officer + Admin with compensating controls.

| # | Gate | GO criteria (unambiguous) | NO-GO if… | Decision |
| - | ---- | ------------------------- | --------- | -------- |
| G1 | Contract init | `get_config` matches approved signer set, threshold, limits, tokens | Any mismatch or uninitialized vault | ☐ GO ☐ NO-GO |
| G2 | Multi-token | Every approved token transferred successfully in acceptance test | Any approved token untested or failing | ☐ GO ☐ NO-GO |
| G3 | Compliance baseline | Baseline documented; Health widget/API reachable; alert threshold set | No baseline or no visibility into `complianceScore` | ☐ GO ☐ NO-GO |
| G4 | Circuit breaker | `circuit_breaker_threshold` **> 0** and equals approved value; drill evidence attached | Threshold `0`/unknown **or** no drill/waiver | ☐ GO ☐ NO-GO |
| G5 | Keeper network | ≥1 production keeper + alert path; successful due-payment poll proven | Single unmonitored laptop cron only, or no alerts | ☐ GO ☐ NO-GO |
| G6 | Notification webhooks | ≥1 critical sink receiving signed events in prod | No webhooks **or** secrets in plaintext repo | ☐ GO ☐ NO-GO |
| G7 | E2E proposal | One real small-value propose→approve→execute completed by Treasurers | Path unproven on production contract | ☐ GO ☐ NO-GO |
| G8 | Limit enforcement | Over-limit attempt failed closed | Over-limit succeeded or untested | ☐ GO ☐ NO-GO |
| G9 | Emergency contacts | Template below completed with 24/7 reachable primary | Blank or untested contacts | ☐ GO ☐ NO-GO |
| G10 | Sign-off | Admin, Treasurer, Security Officer all signed | Any signature missing | ☐ GO ☐ NO-GO |

**Launch rule:** Proceed to production traffic **only if G1–G10 are all GO** (or waived per row with written compensating control).  
**Rollback rule:** If any gate flips to NO-GO after launch (e.g., breaker disabled accidentally), pause vault and re-enter Phase 3 safety acceptance.

**Overall recommendation:** ☐ **GO**  ☐ **NO-GO**  
**Date:** ______________  **Facilitator:** ______________

---

## Emergency contact template

Copy into your password manager / incident channel topic. Test reachability before go-live (G9).

| Function | Name | Role | Primary phone | Secondary phone | Email | Backup person | Notes |
| -------- | ---- | ---- | ------------- | --------------- | ----- | ------------- | ----- |
| Incident commander | | Admin | | | | | Authorizes pause/unpause |
| Treasury lead | | Treasurer | | | | | Payment triage |
| Security Officer | | Security Officer | | | | | Key compromise / breaker |
| DevOps on-call | | DevOps | | | | | RPC, keepers, webhooks |
| Legal / compliance | | (external) | | | | | Regulatory notifications |
| Stellar / infra vendor | | Vendor TAM | | | | | RPC outages |
| Status page URL | — | — | — | — | | | |
| War-room channel | — | — | — | — | | Slack/Discord link |
| Break-glass key ceremony location | — | Admin | — | — | | Offline procedure |

**After-hours escalation order:** (1) DevOps on-call → (2) Incident commander (Admin) → (3) Security Officer → (4) Treasurer (if funds movement decisions required).

**Lost signer device protocol (summary):** Revoke delegations → pause if needed → `remove_signer` / rotate → notify contacts above → post-incident review.

---

## Sign-off

By signing, each party affirms that checklist items under their role are complete (or explicitly waived with references), that the Go/No-Go matrix reflects reality as of the date below, and that they approve production operation of this VaultDAO deployment.

### Admin

| Field | Value |
| ----- | ----- |
| Name | |
| Stellar address | |
| Date | |
| Signature | |
| Exceptions / waivers referenced | |

☐ I affirm Phase 1–4 Admin items are complete and G-gates under my control are GO.

### Treasurer

| Field | Value |
| ----- | ----- |
| Name | |
| Stellar address | |
| Date | |
| Signature | |
| Exceptions / waivers referenced | |

☐ I affirm treasury policy, multi-token acceptance, compliance baseline, and Treasurer operational items are complete.

### Security Officer

| Field | Value |
| ----- | ----- |
| Name | |
| Date | |
| Signature | |
| Exceptions / waivers referenced | |

☐ I affirm `circuit_breaker_threshold`, emergency contacts, pause authority, and security gates are GO (or waived with compensating controls).

---

## Document control

| Version | Date | Author | Changes |
| ------- | ---- | ------ | ------- |
| 2.0 | 2026-07-27 | VaultDAO ops docs | Full enterprise rewrite (Issue #1199); replaces contract↔frontend gap matrix |

**Retention:** File completed checklists with deployment records for at least 12 months (or per your compliance policy).
