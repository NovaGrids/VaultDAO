<!--
  VaultDAO Security Advisory Report Template

  HOW TO USE THIS:
  Do not submit this as a public GitHub issue or pull request.
  Copy the sections below into the description field of GitHub's
  "Report a vulnerability" form (repository Security tab → Advisories →
  Report a vulnerability), or attach it to an email per docs/reference/SECURITY.md
  if private reporting isn't available.

  Delete this comment block before submitting.
-->

## Summary

<!-- One or two sentences. What's wrong, and what's the worst-case impact? -->

## Affected Component

<!-- Be specific. Examples:
- Smart contract function: `contracts/vault/src/lib.rs` → `execute_proposal` (or specific line numbers if known)
- Frontend: `frontend/src/hooks/useVaultContract.ts` → transaction-building logic for X
- Backend: `backend/src/modules/events/normalizers/...` → event normalization for Y
-->

## Vulnerability Type

<!-- Pick the closest fit, or describe if none fit:
- [ ] Authentication / authorization bypass (acting as a role you don't hold)
- [ ] Privilege escalation (a role doing more than it should)
- [ ] Timelock bypass
- [ ] Spending-limit bypass
- [ ] Integer overflow / underflow
- [ ] Cross-contract call risk / reentrancy
- [ ] Double-execution / replay
- [ ] Governance bypass (proposal executes without required approvals/conditions)
- [ ] Fund theft, loss, or permanent lock
- [ ] Other (describe)
-->

## Severity Assessment

<!-- Your assessment, using the table in docs/reference/SECURITY.md. We may
     reclassify after triage — this is a starting point, not a final answer. -->

**Severity:** <!-- Critical / High / Medium / Low -->

**Reasoning:** <!-- Why this severity? What's the impact, and how easy is it to trigger? -->

## Reproduction Steps

<!-- Be as concrete as possible. If this is a contract-level issue, a minimal
     Rust test using the existing harness (see contracts/vault/src/test.rs for
     the setup() pattern) is the gold standard — it lets us reproduce your
     exact finding without guesswork. -->

1.
2.
3.

```rust
// Optional: a minimal #[test] reproducing the issue, if applicable.
// See docs/reference/TESTING.md §2 for the test environment setup pattern
// (Env::default(), env.mock_all_auths(), the setup() helper shape, etc.)
```

## Impact

<!-- Answer concretely:
- What can an attacker actually do?
- Whose funds/access/data is affected?
- What preconditions does the attacker need (e.g., must already be a Signer?
  Admin? No special access at all)?
- Is this exploitable today on Mainnet, Testnet only, or does it require a
  specific, unusual configuration to be reachable?
-->

## Suggested Fix (optional)

<!-- A rough idea is fine — we'll independently verify and may take a
     different approach. Not required, but speeds up triage if you have one. -->

## Additional Context

<!-- Anything else: related findings in AUDIT_SCOPE.md, similar issues you've
     seen in other Soroban contracts, links, etc. -->

## Disclosure Preferences

- [ ] I'd like public credit (GitHub username / name): ____________
- [ ] I'd prefer to remain anonymous
- [ ] I am willing to collaborate on a fix in a temporary private fork
- [ ] I am reporting this because I believe it is being actively exploited (if so, say so explicitly above — this changes our response timeline)
