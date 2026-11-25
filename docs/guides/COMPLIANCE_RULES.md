# Compliance Rules (Operators)

The compliance score is computed from **rule outcomes**, not from how many audit entries exist. Adding more compliant entries leaves the score unchanged; a rule flipping from compliant to review (or back) changes it.

## How scoring works

- Each rule is evaluated against the audit entries in the report period (indexed on-chain events).
- A rule with no applicable events is **NOT EVALUATED** and is excluded from the score.
- Score = compliant rules / evaluated rules, as a percentage. If no rule was evaluated the score is shown as "Not evaluated".

## Rule configuration

Rules are plain JSON objects. `parseComplianceConfig()` validates untrusted config and reports every error (unknown kind, bad id, duplicate id, over 50 rules).

| `kind` | Checks | Options |
| --- | --- | --- |
| `timelock` | Each `proposal_executed` follows a `proposal_ready` event for the same proposal | none |
| `approval_threshold` | Each execution has enough distinct approvers before it (uses `details.threshold`) | `defaultThreshold` (default 1) |
| `spending_limit` | Executed `details.amount` is at most `maxAmount` | `maxAmount`: digits-only base-unit string |
| `signer_policy` | Approvers are in `allowedSigners`; proposers do not approve their own proposal | `allowedSigners`, `forbidSelfApproval` |
| `breaker` | No `proposal_executed` for a token between `token_breaker_tripped` and `token_breaker_reset` | none |

```json
[
  { "kind": "timelock", "id": "timelock", "label": "Timelock adherence" },
  { "kind": "spending_limit", "id": "cap", "label": "Per-proposal cap", "maxAmount": "1000000000" },
  { "kind": "signer_policy", "id": "signers", "label": "Signer policy", "forbidSelfApproval": true },
  { "kind": "breaker", "id": "breaker", "label": "Circuit breaker" }
]
```

Without a config the defaults are `timelock` and `approval_threshold`. Events missing the fields a rule needs (for example no `amount`) are skipped rather than counted as passes or failures.

## Explainability

Each violating rule lists **evidence**: the audit entry id, the on-chain event id, the action, the timestamp and a plain-text reason. At most 20 pointers are kept per rule; the rest are counted as `evidenceOmitted`. The Compliance Reports page shows these under "Rule results", and the PDF preview includes them.

## Safe rendering

All audit-derived text (rule labels, actions, notes, entry ids) is HTML-escaped in previews and rendered as React text in the UI. Status is shown as a text label with a symbol, never by color alone.

## Limits

- Evaluation runs in the browser against the entries already loaded for the report; there is no server-side compliance API yet.
- Rule outcomes reflect indexed audit events only, not a re-read of live contract state.
