# Security Policy

VaultDAO handles treasury funds on-chain. We take security seriously, and we'd rather hear about a problem from you, privately and early, than find out about it from an exploit. This document explains what's in scope, how to report a vulnerability, what response times you can realistically expect, and what happens after you report something.

This policy is a companion to [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md), which catalogues known attack surfaces and open findings in the contract today — read that first if you're looking for a starting point rather than reporting something new.

## Supported Versions

VaultDAO is currently in **Beta (Open Source MVP)**. We focus our security efforts on the latest version on `main`; there is no long-term-support branch at this stage.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Scope

### In scope

- **Smart contract vulnerabilities** in `contracts/vault/src/` — anything that lets value move, be locked, or be destroyed in a way the contract's rules don't intend. Concretely: authentication or authorization bypasses (acting as a role you don't hold, or having a role do more than it should), spending-limit or timelock bypasses, integer overflow/underflow that changes a balance or amount, double-execution of a proposal, cross-contract call risks (a malicious or non-standard token contract manipulating vault state), and any way to drain, lock, or misdirect funds.
- **Governance bypasses** — anything that lets a proposal execute, or a privileged action occur, without the approvals/conditions the contract claims to require (see [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) §2 for the formal invariants this contract is supposed to uphold).
- **Backend or frontend issues with on-chain consequences** — for example, if the frontend constructs a transaction that doesn't match what the user approved, or the backend's event-indexing logic could be tricked into recording an incorrect on-chain state that downstream automation acts on.
- **Dependency vulnerabilities** with a realistic path to exploitation in this project's actual usage (not just "this crate/package has a CVE somewhere in its changelog" — explain how it's reachable here).

### Out of scope

- **Gas/CPU-budget optimization.** A function costing more than it strictly needs to is a performance issue, not a security one, unless the cost itself enables a denial-of-service (see "within-contract resource exhaustion" below, which *is* in scope).
- **UX issues** — confusing error messages, unclear button labels, missing loading states. File these as a regular bug report instead.
- **Theoretical attacks requiring physical access** to a signer's device, or to Anthropic/Stellar/GitHub's own infrastructure. We care about attacks against VaultDAO's code, not about defending against someone who already has a signer's unlocked laptop.
- **Social engineering, phishing, or key-compromise scenarios themselves.** If you find a way the *contract* makes a compromised key more dangerous than it should be (for example, no way to revoke a compromised signer quickly), that's in scope. "I could trick someone into approving a transaction" is a phishing report, not a VaultDAO vulnerability report, unless the contract's own UI/flow is what made the trick possible.
- **Issues only reproducible on a fork/local devnet that don't reflect real network behavior**, unless you can show the same logic would hold on Testnet/Mainnet.
- **Already-known issues.** Check [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) (especially its "Prior Issues" section) and open issues/PRs before reporting — if it's already tracked, a duplicate report doesn't need the private channel below; a comment or a regular issue referencing the existing one is fine.
- **Spam, rate-limiting, or volumetric denial-of-service against the network itself** (as opposed to a single contract call doing unbounded work — that's in scope).

If you're not sure whether something qualifies, report it anyway through the process below. We'd much rather triage a borderline report than miss a real one because someone assumed it didn't count.

## Reporting a Vulnerability

**Do not open a public GitHub issue, pull request, or discussion thread for a security vulnerability.** Public disclosure before a fix is available puts user funds at risk.

### Preferred: GitHub Private Vulnerability Reporting

This repository should be configured to accept private vulnerability reports directly through GitHub — go to the repository's **Security** tab → **Advisories** → **Report a vulnerability**. This is the preferred channel because it requires no email setup on your end, creates a private collaboration space automatically, and lets you track the report's status directly.

> **Maintainer note:** if the "Report a vulnerability" button isn't visible on the Security tab, private vulnerability reporting has not yet been enabled for this repository. An admin needs to turn this on under **Settings → Security → Private vulnerability reporting**. Until that's done, the email channel below is the only working option, and this note should be removed once it's enabled.

### Backup: Email

If private reporting isn't available, or you prefer email: **`[MAINTAINER ACTION REQUIRED: insert a real, monitored security contact address or PGP-capable address here]`**.

We are not going to put a placeholder-looking fake address in this document — if you're a maintainer reading this and that bracketed text is still here, that means nobody has filled it in yet, and you should not assume vulnerability reports are reaching anyone.

### What to include in your report

A good report lets us understand and reproduce the issue without back-and-forth. Include:

1. **A clear description** of the vulnerability and which contract function(s), or which frontend/backend code path, it affects.
2. **Reproduction steps** — ideally a minimal sequence of contract calls (or a small Rust test using the existing test harness in `contracts/vault/src/test.rs`) that demonstrates the issue. If it's a frontend/backend issue, a reproducible request/response sequence.
3. **Impact assessment** — what can an attacker actually do? Steal funds? Lock funds? Bypass a specific role check? Be specific about *whose* funds and under *what* preconditions (does it require being a signer already? Admin? No special access at all?).
4. **A suggested fix**, if you have one — even a rough idea. We will independently verify any suggested fix; offering one speeds up triage but isn't required.
5. **Your assessment of severity**, using the table below, and your reasoning — we may reclassify after triage, but a starting assessment helps us prioritize incoming reports.

A ready-to-use report template is provided at [`.github/SECURITY_ADVISORY_TEMPLATE.md`](../../.github/SECURITY_ADVISORY_TEMPLATE.md) — copy it into the description field of the GitHub advisory form.

## Response SLA

These timelines reflect what an actively-developed, community-driven, beta-stage project can realistically commit to — we are not a funded security team with 24/7 on-call coverage, and we'd rather state an honest timeline than promise something we routinely miss.

| Stage | Target timeline | Notes |
|---|---|---|
| **Acknowledgement** | Within 48 hours | A human will confirm we've seen your report. This is not the same as triage — it just means someone has read it. |
| **Triage** (initial severity assessment, confirm it's reproducible) | Within 7 days | For a report that's clear and reproducible, triage is often faster. Complex reports involving multiple interacting contract subsystems (see [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) for how interconnected some of this contract's logic is) may take the full window. |
| **Fix timeline — Critical** | Best effort, typically within 7–14 days of triage | Depends on whether a fix requires a contract redeploy/migration versus a frontend/backend patch. We will communicate a specific target once triage is complete, and update you if that target slips. |
| **Fix timeline — High** | Typically within 30 days of triage | |
| **Fix timeline — Medium** | Next regular release cycle | |
| **Fix timeline — Low** | Best effort, no fixed deadline | Tracked, but may be addressed alongside other work rather than urgently. |

We will not commit to a guaranteed turnaround under 48 hours for acknowledgement — given this project's current size and structure, promising same-day or few-hour response would not be a commitment we could reliably keep, and a broken promise is worse than an honest one.
## Severity Classification

Severity is assessed by combining **impact** (what can happen) with **likelihood** (how easy is it to trigger, and does it require privileged access). Examples below are drawn from this contract's actual code — not generic web-security examples — including findings already documented in [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md). Listing a known issue here is not a contradiction of its status there; it illustrates the category using a real, verified example, and the audit-scope document remains the source of truth for that finding's current status.

| Severity | Definition | VaultDAO-specific example | Fix urgency |
|---|---|---|---|
| **Critical** | Direct, unprivileged path to theft, loss, or permanent lock of vault funds; or a complete bypass of a core governance guarantee that requires no special access to trigger. | A contract upgrade that deploys code different from what signers actually approved. `AUDIT_SCOPE.md` §1.6 documents that `execute_upgrade` currently substitutes a hardcoded placeholder hash instead of the hash unanimously approved in `propose_upgrade` — meaning the entire timelocked, unanimous-approval upgrade governance process has no causal connection to what code actually runs. If this resulted in a usable, unintended contract being deployed (rather than the call simply failing), that would be Critical: it defeats every other security guarantee in the contract at once, since a malicious upgrade could rewrite any rule. | Immediate — would justify pausing the contract (if a pause mechanism is available) and an out-of-band fix, not waiting for the next release cycle. |
| **High** | A bypass of a specific, named security control (timelock, spending limit, role boundary) that doesn't require unprivileged access to trigger, but causes serious, hard-to-reverse impact once triggered — including by a legitimately-privileged-but-not-fully-trusted actor, or by ordinary administrative misconfiguration. | The unilateral signer-tier execution path (`can_execute_unilaterally`, see `AUDIT_SCOPE.md` §1.3) never checks the transfer amount against `config.timelock_threshold`, and `set_signer_tier` never validates a tier's limit against that threshold either. An Admin who grants a signer a tier limit above the timelock threshold — plausibly by mistake, since nothing warns them of the interaction — gives that signer the ability to instantly execute large transfers that the timelock exists specifically to delay, with no opportunity for other signers to review or cancel. | Within the current release cycle; should not ship a new version without addressing or explicitly documenting this as intended behavior. |
| **Medium** | A real gap in a defense-in-depth mechanism, or a logic inconsistency that produces incorrect-but-bounded results, where exploitation requires specific conditions, existing privileged access, or produces limited (not total) impact. | The spending-limit refund bug (`AUDIT_SCOPE.md` §1.4): `refund_spending_limits` credits whatever day/week bucket is current *at the time of refund*, not the bucket the original spend was debited from. If a proposal is created on day N and cancelled on day N+1, day N's bucket stays incorrectly debited while day N+1 gets an unearned credit. The drift is real and demonstrable, but bounded per-incident by the proposal's own amount, and doesn't grant unbounded extra spending room in one step. | Next regular release; worth fixing before it compounds across many cancel/expire cycles. |
| **Low** | An issue that weakens confidence in the code's correctness or maintainability, or a very narrow edge case with minimal practical impact, but doesn't on its own enable fund loss or a meaningful access-control bypass. | Raw (non-`checked`/non-`saturating`) `i128` multiplication on user-influenced values like `stream.rate * total_active_seconds` (`AUDIT_SCOPE.md` §1.5), combined with no `[profile.release] overflow-checks = true` in `Cargo.toml`. `i128`'s width makes practical overflow unlikely with realistic token amounts, but there's no compile-time or runtime safety net if an assumption about realistic input sizes turns out to be wrong elsewhere. | Tracked; bundle with other hardening work rather than treating as urgent on its own. |

### A note on conservative classification

If you're unsure whether something is High or Medium, report it as the higher severity and explain your reasoning — we will downgrade after triage if warranted, but we'd rather start cautious. The same principle that governs `AUDIT_SCOPE.md`'s own risk ratings applies here: when exploitability is genuinely uncertain, treat it as more severe until proven otherwise, not less.

### A note on "duplicate declaration" style bugs

Several issues found in this codebase recently (a duplicate struct field, a duplicate enum variant, duplicate test function names — see `AUDIT_SCOPE.md` §4 for the full list) are **compile-time errors, not exploitable vulnerabilities** — a contract that fails to compile cannot be deployed in that state at all. These don't need a private security report; a normal public bug report or PR is the right channel, since there's no secret to protect (the bug is visible to anyone reading the source, and reporting it publicly doesn't create new risk). Use the private channel above specifically for issues that are exploitable *once deployed*, not for things that prevent deployment entirely.

## Responsible Disclosure Timeline

1. **You report.** Through GitHub private vulnerability reporting (preferred) or the email channel above.
2. **We acknowledge** within 48 hours (see SLA above).
3. **We triage** within 7 days — confirming reproducibility, assigning a severity per the table above, and, if accepted, opening a private GitHub Security Advisory draft (if not already created via the private-reporting flow) so we can collaborate with you directly, including inviting you to a temporary private fork if a fix needs to be developed collaboratively.
4. **We fix**, on the timeline implied by severity (see SLA table above). We'll keep you updated if the timeline changes — we'd rather tell you a fix is taking longer than expected than go silent.
5. **Coordinated disclosure.** Once a fix is deployed (or, for issues that can't be meaningfully "fixed" via redeploy — like something that already executed on Mainnet — once we've assessed and communicated the impact), we'll agree with you on a disclosure date. Our default expectation, absent an agreed alternative, is **30 days after a fix ships**, giving users time to upgrade/migrate before full public details are published. This mirrors common industry practice (for reference, the GitHub Security Lab's own public template defaults to 90 days from *first report*, which — given our faster expected fix timeline above — would usually land after our fix is already out).
6. **Public disclosure.** We will publish the GitHub Security Advisory (requesting a CVE if appropriate) and credit you, if you'd like credit, once disclosure is appropriate. If you believe a vulnerability is being actively exploited in the wild, tell us immediately — that changes our timeline, and we may disclose mitigations faster even before a full fix, to help users protect themselves.
7. **You may disclose independently after the agreed date**, or sooner if we go unresponsive well past the SLA above with no explanation — we ask that you make a good-faith effort to reach us through both channels above first, and check the repository for any public acknowledgement (e.g., a recent commit or advisory) before assuming we've gone silent.

## Bug Bounty Program

VaultDAO does not currently have a funded bug bounty program. We want to be upfront about that rather than imply one exists. What we can commit to today:

- **Public credit** in the published security advisory and in release notes, if you want it (you can also choose to remain anonymous).
- **A `SECURITY.md` mention** in a "Hall of Fame"-style acknowledgements section, if/when this project adds one.

**Bounty scope, reward tiers, and payment method are TBD by maintainers.** If and when a funded bounty program launches, it will be announced here with concrete numbers, not vague ranges, and this section will be updated to reflect:
- Which severities qualify for a reward (likely Critical/High only, to start)
- Reward amounts or ranges per severity tier
- Payment method (most likely on-chain, given the project's nature — but this needs an explicit decision from maintainers, including how it interacts with regional/legal constraints on paying anonymous reporters)
- Whether reports on the *audit findings already listed in `AUDIT_SCOPE.md`* are bounty-eligible (typically, already-known/already-disclosed issues are excluded from bounty programs, since the point of a bounty is to surface *new* information)

If you're a maintainer reading this and want to stand up a bounty program, decide those four things first, then replace this section — don't announce a program before reward amounts and payment logistics are actually settled, since reneging on an implied reward is worse for community trust than not having a program yet.

## Security Considerations for VaultDAO

The following measures exist in the current implementation:

- **Rust for memory safety** — the smart contract is written in Rust, which prevents common low-level memory vulnerabilities (buffer overflows, use-after-free) by construction.
- **Soroban sandboxing** — the contract runs in the Soroban host environment, which enforces resource limits (the "budget" system — see `docs/reference/TESTING.md` §2.10 for how to test against it) and call-level security boundaries.
- **Multi-signature logic** — critical actions require M-of-N approval (`config.threshold`), with an additional unilateral-execution path for small amounts under a signer's configured tier limit (see the High-severity example above for why this needs careful configuration).
- **Timelocks** — transfers at or above `config.timelock_threshold` are delayed until `unlock_ledger`, giving other signers a window to notice and cancel an unauthorized or mistaken proposal — except via the unilateral path noted above.
- **RBAC** — a five-role hierarchy (`Observer < Member < Treasurer < Admin`, plus `DisputeArbitrator`) gates sensitive functions. See `AUDIT_SCOPE.md` §1.2 for a known inconsistency in how this hierarchy is enforced across different functions.

This list describes what the contract is *designed* to do, not an independent guarantee that every code path correctly implements it — that's precisely what `AUDIT_SCOPE.md` and a future third-party audit are for.

## Audits

VaultDAO has **not yet undergone a formal third-party security audit**. Users should interact with the platform at their own risk and avoid depositing significant funds until an audit is completed.

See [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) for the attack surface catalogue, formal invariants, and known findings that will guide that audit once it's commissioned.
