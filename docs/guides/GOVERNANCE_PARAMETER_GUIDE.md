# Governance Parameter Selection Guide

This guide helps vault operators choose initial governance parameters (`InitConfig` / `ConfigParam`) for three common VaultDAO archetypes: **Personal Multisig**, **DAO Treasury**, and **Escrow Agent**.

For the mechanics of updating parameters after initialization, see [Governance Config Changes](./GOVERNANCE_CONFIG_CHANGES.md).

---

## Vault Archetypes & Recommended Parameters

### 1. Personal Multisig (2-of-3 / 3-of-5)
Designed for an individual or small family/team securing personal or operational funds across hardware wallets and backup keys.

| Parameter | Recommended Value | Rationale |
|---|---|---|
| `threshold` | `2` (of 3) or `3` (of 5) | Protects against single-key compromise while tolerating 1–2 lost keys. |
| `governance_threshold` | `67%` | Prevents a single signer from altering vault rules. |
| `quorum` / `quorum_percentage` | `0` (disabled) | Small signer sets already enforce participation via `threshold`. |
| `timelock_threshold` | `10%–20%` of vault balance | Routine transfers execute immediately; large transfers trigger a review window. |
| `timelock_delay` | `17,280` ledgers (~24 hours) | Gives the owner time to veto or cancel if a key is compromised. |
| `spending_limit` / `daily_limit` | Tightly scoped to monthly/daily needs | Caps blast radius if threshold keys are phished. |
| `default_voting_deadline` | `120,960` ledgers (~7 days) | Avoids stale proposals lingering indefinitely. |

### 2. DAO Treasury (5-of-9 / 7-of-11)
Designed for protocol treasuries, grants committees, and community-governed funds with distributed signers.

| Parameter | Recommended Value | Rationale |
|---|---|---|
| `threshold` | `5` (of 9) or `60%` | Balances liveness across time zones with strong collusion resistance. |
| `governance_threshold` | `75%` | High bar for changing core rules, limits, or signer-adjacent parameters. |
| `quorum_percentage` | `50%` | Ensures broad signer participation rather than a narrow subset. |
| `timelock_threshold` | `1%–5%` of treasury | Nearly all meaningful treasury outflows undergo public timelock review. |
| `timelock_delay` | `34,560–51,840` ledgers (~48–72 hours) | Provides community/security-council reaction time to veto malicious proposals. |
| `daily_limit` / `weekly_limit` | `2%` daily / `10%` weekly | Prevents rapid treasury draining even if `threshold` signers collude. |
| `high_impact_threshold` | `70%` | Requires supermajority for high-value or sensitive actions. |

### 3. Escrow Agent (2-of-3 with Arbiter)
Designed for bilateral trade, milestone-based contracting, or OTC settlement where two parties and a neutral arbiter hold keys.

| Parameter | Recommended Value | Rationale |
|---|---|---|
| `threshold` | `2` (of 3) | Either both parties agree (2-of-2), or one party + arbiter resolves a dispute. |
| `governance_threshold` | `100%` | Prevents any two parties from changing escrow rules without unanimous consent. |
| `quorum` | `0` | `threshold = 2` already requires 2 of 3 participants. |
| `timelock_threshold` | `0` (all) or `> 0` for large releases | Optional short delay (`3,600` ledgers / ~5 hours) for dispute escalation. |
| `timelock_delay` | `3,600` ledgers (~5 hours) | Allows emergency veto if an automated release is contested. |
| `spending_limit` | Full escrow amount | Escrow typically releases the full agreed milestone or principal. |

---

## Risk Trade-Offs by Parameter

- **`threshold` & `governance_threshold`**: Higher values reduce collusion and compromise risk, but increase operational friction and the risk of permanent fund lockup if signers lose keys.
- **`timelock_delay` & `timelock_threshold`**: Longer delays give defenders time to detect and veto malicious proposals, at the cost of slower capital deployment during urgent market or operational events.
- **`spending_limit`, `daily_limit`, `weekly_limit`**: Tighter limits bound worst-case loss per period, but overly tight limits force frequent governance overrides or split proposals.
- **`quorum` / `quorum_percentage`**: Higher quorum prevents low-turnout capture, but can stall routine operations if signers are inactive.
- **`default_voting_deadline`**: Shorter deadlines keep the proposal queue clean and prevent stale approvals from executing months later, but may expire legitimate proposals in slow-moving DAOs.
