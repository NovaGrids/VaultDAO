# Security Vulnerability Disclosure Process

VaultDAO handles treasury funds through on-chain governance and contract-controlled transfers. Please report suspected vulnerabilities privately so maintainers can investigate and coordinate a fix before public details put user funds at risk.

This policy explains what is in scope, how to submit a report, what information to include, how severity is classified, and how disclosure and bounty decisions are handled. It complements [`../AUDIT_SCOPE.md`](../AUDIT_SCOPE.md), which documents known attack surfaces, invariants, and previously identified findings.

## Supported Versions

VaultDAO is currently in beta as an open-source MVP. Security support focuses on the latest code on `main`; there is no long-term-support branch yet.

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |
| `< 0.1` | No |

## Scope

### In scope

Reports are in scope when they show a realistic way to break VaultDAO's security guarantees or put funds, governance, or signer authority at risk. Examples include:

- Smart contract exploits in `contracts/vault/src/` that allow theft, loss, permanent locking, or misdirection of funds.
- Authentication or authorization bypasses, including acting as a role the caller does not hold or expanding a role beyond its intended authority.
- Governance bypasses where proposals, upgrades, dispute actions, or privileged configuration changes execute without the required approvals, quorum, role, timelock, or other condition.
- Timelock, spending-limit, signer-tier, or multisig threshold bypasses.
- Double execution, replay, inconsistent proposal state, or cross-contract call behavior that changes vault state in an unintended way.
- Integer overflow, underflow, rounding, or accounting errors that can affect balances, limits, fees, streaming payments, recurring payments, staking, insurance, or escrow logic.
- Frontend or backend issues with on-chain consequences, such as building a transaction different from what the user approved or indexing events in a way that downstream automation could trust incorrectly.
- Dependency vulnerabilities with a concrete path to exploitation in VaultDAO's actual code or deployment flow.

### Out of scope

The following issues should use normal public issues or pull requests unless they directly enable one of the in-scope impacts above:

- Gas, CPU, budget, or storage optimization without a security impact.
- UX bugs, confusing labels, missing loading states, copy changes, or documentation typos.
- Theoretical attacks that require physical access to a signer's device or prior compromise of Stellar, Soroban, GitHub, or a maintainer's infrastructure.
- Social engineering, phishing, or private-key compromise by itself. A contract or UI behavior that makes such compromise unexpectedly worse may still be in scope.
- Reports that only reproduce on a local fork or devnet and do not map to Testnet, Mainnet, or the current code's real execution model.
- Already-known issues documented in [`../AUDIT_SCOPE.md`](../AUDIT_SCOPE.md), open issues, or merged pull requests, unless your report adds new exploitability, impact, or reproduction evidence.
- Volumetric denial-of-service against the public network, as opposed to a VaultDAO contract path with unbounded or attacker-amplified work.
- Compile errors or duplicate declarations that prevent deployment. Those are important bugs, but they are not private security vulnerabilities because undeployable code cannot be exploited as deployed code.

When in doubt, report privately. Maintainers can redirect out-of-scope reports to the public tracker after triage.

## Reporting Process

Do not open a public GitHub issue, pull request, discussion, or social media thread for a suspected security vulnerability.

### Preferred channel: GitHub private vulnerability reporting

Use GitHub's private reporting flow:

1. Open the repository on GitHub.
2. Go to **Security**.
3. Choose **Advisories**.
4. Select **Report a vulnerability**.
5. Paste the report details using [`.github/SECURITY_ADVISORY_TEMPLATE.md`](../../.github/SECURITY_ADVISORY_TEMPLATE.md).

This channel is preferred because it creates a private GitHub Security Advisory workspace, supports maintainer collaboration, and matches GitHub's advisory workflow for affected versions, patched versions, CVEs, and coordinated disclosure.

If the **Report a vulnerability** button is not visible, repository administrators need to enable private vulnerability reporting under **Settings -> Security -> Private vulnerability reporting**.

### Backup channel: encrypted email

The maintainers have not published a monitored encrypted security email address yet. Until they do, use GitHub private vulnerability reporting.

Maintainers should add a real security contact here before announcing an email-based intake path. The address should be monitored, accept encrypted reports, and have a published PGP key or equivalent encryption instructions.

## What To Include

A strong report should let maintainers reproduce the issue without guessing. Include:

- Summary of the vulnerability and the worst-case impact.
- Affected component, such as a contract function, frontend transaction-building path, backend indexer path, deployment script, or dependency.
- Affected versions, branches, commit hashes, deployed contract IDs, networks, or configuration assumptions if known.
- Reproduction steps. For contract issues, a minimal Rust test using the existing `contracts/vault` test harness is ideal.
- Preconditions, including whether the attacker needs to be a signer, Admin, Treasurer, DisputeArbitrator, token contract deployer, ordinary user, or completely unauthenticated caller.
- Impact assessment: what can be stolen, locked, bypassed, corrupted, replayed, or executed unexpectedly.
- Suggested severity using the table below, plus reasoning.
- Suggested fix or mitigation, if you have one.
- Whether you believe the issue is actively exploited.
- Disclosure and credit preferences.

Use [`.github/SECURITY_ADVISORY_TEMPLATE.md`](../../.github/SECURITY_ADVISORY_TEMPLATE.md) as the report format.

## Response SLA

These targets are intended to be realistic for a community-driven beta project. They are not a 24/7 emergency response guarantee.

| Stage | Target timeline | What to expect |
| --- | --- | --- |
| Acknowledgement | Within 48 hours | A maintainer confirms the report was received and is being reviewed. |
| Initial triage | Within 7 days | Maintainers attempt to reproduce the issue, decide whether it is in scope, and assign an initial severity. |
| Critical fix target | Best effort within 7 to 14 days after triage | The project may prioritize emergency mitigations, pausing if available, private patches, redeploy guidance, or coordinated user migration. |
| High fix target | Typically within 30 days after triage | The issue should be fixed or explicitly mitigated before the next security-sensitive release. |
| Medium fix target | Next regular release cycle | The issue is tracked and fixed with normal release planning. |
| Low fix target | Best effort, no fixed deadline | The issue is tracked and may be bundled with hardening or cleanup work. |

If a report is being actively exploited, say so clearly in the initial submission. Active exploitation may require faster mitigations or earlier public guidance.

## Severity Classification

Severity combines impact and likelihood. Maintainers may reclassify after triage.

| Severity | Definition | VaultDAO-specific examples | Fix priority |
| --- | --- | --- | --- |
| Critical | Direct path to steal, destroy, permanently lock, or arbitrarily redirect vault funds; or a complete governance or upgrade bypass that can compromise all other controls. | A proposal execution path that transfers funds without required signer approval; a contract upgrade path that deploys code different from the hash signers approved; a cross-contract call pattern that allows the same approved transfer to execute more than once. | Immediate emergency response. |
| High | Bypass of a core security control with serious financial or governance impact, even if it requires privileged access, misconfiguration, or specific setup. | A signer-tier limit that lets one signer bypass the configured timelock for large transfers; an Admin-only role path that unintentionally grants Admin-equivalent authority to a narrower role; a spending-limit bypass that allows a signer to exceed daily or weekly treasury controls. | Prioritize in the current release cycle. |
| Medium | Real security weakness with bounded impact, meaningful preconditions, or defense-in-depth failure that could become severe when combined with another issue. | Refund accounting that credits the wrong day or week bucket after cancellation; raw arithmetic on user-influenced payment or stream amounts where overflow is unlikely but not explicitly prevented; event indexing that could mislead downstream automation without changing on-chain state. | Fix in the next regular release cycle. |
| Low | Narrow edge case, hardening issue, misleading state, or maintainability concern with minimal practical impact by itself. | Missing validation that only affects impossible or undeployed configurations; incomplete security logging; unclear error handling around rejected proposals where funds and permissions remain safe. | Track and bundle with hardening work. |

If you are unsure between two levels, choose the higher one and explain why. Maintainers will downgrade if the impact or exploitability is lower than reported.

## Responsible Disclosure Timeline

The default process is:

1. You submit a private report through GitHub private vulnerability reporting.
2. Maintainers acknowledge within 48 hours.
3. Maintainers triage within 7 days, assign severity, and confirm whether the report is accepted.
4. If accepted, maintainers use a private GitHub Security Advisory draft to coordinate investigation, fix development, affected version notes, patched version notes, and disclosure text.
5. Maintainers develop and validate a fix or mitigation according to severity.
6. Once the fix is available, maintainers coordinate a disclosure date with you. The default target is public disclosure 30 days after the fix ships, unless active exploitation, user migration risk, or mutual agreement requires a different timeline.
7. Public disclosure happens through the GitHub Security Advisory, release notes, and any required user migration or mitigation guidance. Maintainers may request a CVE when appropriate.

Researchers should not disclose technical details publicly before a fix or mitigation is available unless the project becomes unresponsive well beyond the SLA and good-faith attempts to reconnect have failed. Before independent disclosure, check the repository for recent maintainer activity, commits, releases, or advisory updates.

## Bug Bounty Program

VaultDAO does not currently have a funded bug bounty program. Reports are welcome, but maintainers have not approved reward tiers or payment logistics.

Current commitments:

- Public credit in the advisory and release notes if you want credit.
- Anonymous disclosure if you prefer not to be named.
- Good-faith collaboration through the private advisory workflow.

Program details are TBD by maintainers, including:

- Which assets, networks, and versions are bounty-eligible.
- Which severities qualify for rewards.
- Reward amounts or ranges for Critical, High, Medium, and Low reports.
- Payment method, including whether rewards are paid on-chain and what compliance requirements apply.
- Whether known findings in [`../AUDIT_SCOPE.md`](../AUDIT_SCOPE.md) are excluded from rewards.
- Rules for duplicate reports, public disclosure before fix, testing on live deployments, and reports involving third-party services.

No reward should be considered promised until this section is updated with concrete terms.

## Safe Harbor

VaultDAO asks researchers to act in good faith:

- Do not access, modify, exfiltrate, or destroy user funds or private data.
- Do not interrupt public networks, third-party services, or other users.
- Use the minimum testing needed to prove the issue.
- Stop testing and report immediately if you encounter live funds, private data, or active exploitation.
- Follow the [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) when interacting with maintainers and contributors.

Reports that follow this policy will be treated as authorized security research by the project maintainers, subject to applicable law and third-party platform rules.

## Audits And Known Findings

VaultDAO has not yet completed a formal third-party security audit. Users should treat the project as beta software and avoid depositing significant funds until audits, fixes, and deployment guidance mature.

For current attack-surface notes, invariants, and known findings, read [`../AUDIT_SCOPE.md`](../AUDIT_SCOPE.md).
