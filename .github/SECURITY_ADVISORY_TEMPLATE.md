<!--
VaultDAO Security Advisory Report Template

Do not submit this as a public issue or pull request.
Use GitHub's private vulnerability reporting flow:
Security -> Advisories -> Report a vulnerability.

Delete this comment block before submitting.
-->

## Summary

<!-- One or two sentences describing the vulnerability and worst-case impact. -->

## Affected Component

<!-- Be specific. Examples:
- Contract function: contracts/vault/src/lib.rs -> execute_proposal
- Contract storage/accounting: spending limit buckets, proposal status, signer tiers
- Frontend transaction path: frontend/... -> transaction construction for approvals
- Backend/indexer path: backend/... -> event normalization or automation trigger
- Deployment or dependency: script/package/crate and version
-->

## Affected Versions And Environments

<!-- Include anything known:
- Branch, tag, commit, or release
- Deployed contract ID(s)
- Network: local, Testnet, Mainnet
- Browser/backend/runtime versions if relevant
- Configuration required to trigger the issue
-->

## Vulnerability Type

<!-- Check or keep the closest categories. -->

- [ ] Authentication or authorization bypass
- [ ] Privilege escalation
- [ ] Governance bypass
- [ ] Timelock bypass
- [ ] Spending-limit or signer-tier bypass
- [ ] Double execution or replay
- [ ] Cross-contract call or non-standard token risk
- [ ] Integer overflow, underflow, rounding, or accounting error
- [ ] Fund theft, fund loss, fund lock, or fund misdirection
- [ ] Frontend/backend behavior with on-chain consequences
- [ ] Dependency or supply-chain vulnerability
- [ ] Other:

## Severity Assessment

<!-- Use docs/reference/SECURITY.md as the severity guide. Maintainers may reclassify after triage. -->

**Severity:** Critical / High / Medium / Low

**Reasoning:**

<!-- Explain impact and likelihood. Note whether the attacker needs no access, signer access, Treasurer/Admin access, a malicious token contract, or a specific configuration. -->

## Reproduction Steps

<!-- Be concrete enough for maintainers to reproduce without guessing. For contract-level issues, a minimal Rust test using the existing contracts/vault test harness is ideal. -->

1.
2.
3.

```rust
// Optional minimal reproducer.
```

## Impact

<!-- Answer concretely:
- What can an attacker do?
- Whose funds, authority, proposals, limits, or records are affected?
- Can this steal funds, lock funds, bypass approvals, bypass timelocks, corrupt accounting, or mislead downstream automation?
- Is the issue exploitable today or only under a specific deployment/configuration?
-->

## Suggested Fix Or Mitigation

<!-- Optional. A rough mitigation is useful, but maintainers will independently verify the fix. -->

## Active Exploitation

- [ ] I believe this is actively exploited.
- [ ] I do not have evidence of active exploitation.
- [ ] Unknown.

<!-- If active exploitation is suspected, explain what you observed without revealing public exploit details. -->

## Disclosure Preferences

- [ ] I would like public credit.
- [ ] I prefer to remain anonymous.
- [ ] I am willing to help validate a fix in a private advisory or private fork.

**Credit name or GitHub handle:**

## Additional Context

<!-- Related code links, related AUDIT_SCOPE.md findings, screenshots, logs, transaction hashes, Soroban traces, or comparable vulnerabilities. -->
