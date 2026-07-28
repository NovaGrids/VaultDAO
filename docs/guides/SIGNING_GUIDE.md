# VaultDAO Signing Guide

**Who this is for:** Board members, treasurers, and other authorized signers who approve treasury proposals from a browser. You do not need to know Rust, Soroban, or how smart contracts work. You only need Freighter (or a compatible air-gapped device for cold signing) and a clear checklist of what to verify before you click **Approve Proposal**.

**Related UI:** The screens described here map to `ProposalDetailModal`, `SignatureFlow`, and `QRSignature` in the VaultDAO dashboard.

---

## Table of contents

1. [Signer setup](#1-signer-setup)
2. [Voting workflow](#2-voting-workflow)
3. [Signing step-by-step](#3-signing-step-by-step)
4. [Delegation](#4-delegation)
5. [Emergency and QR cold-storage signing](#5-emergency-and-qr-cold-storage-signing)
6. [FAQ](#6-faq)
7. [Quick reference checklist](#7-quick-reference-checklist)

---

## 1. Signer setup

Signing in VaultDAO is deliberately simple: your organization puts your Stellar public address on the vault’s signer list (or assigns you a **Treasurer** / **Admin** role), you install Freighter, you connect once, and then you approve proposals that match your authority. This section walks through that setup without jargon.

### 1.1 Install and unlock Freighter

Freighter is a browser extension wallet for Stellar. VaultDAO uses it the same way a bank app uses a secure login prompt: you review a transaction summary, then confirm or decline.

1. Install Freighter from the official site: [https://www.freighter.app/](https://www.freighter.app/).
2. Create a new wallet **or** import an existing one with your recovery phrase. Store the recovery phrase offline. Never paste it into VaultDAO, Discord, email, or a “support” chat.
3. Unlock Freighter with your password before opening the VaultDAO dashboard.
4. In Freighter’s network selector, choose the network your organization uses:
   - **Testnet** for practice and staging vaults.
   - **Public** (Mainnet) for production treasuries.

**Mockup — Freighter unlock:** Imagine a small extension popup in the top-right of your browser. Title: “Freighter.” Fields: password. Primary button: **Unlock**. Below that, a network chip that says **TESTNET** or **PUBLIC**. If the chip does not match what your Admin told you, stop and switch networks before connecting to VaultDAO.

### 1.2 Connect your wallet to VaultDAO

1. Open the VaultDAO dashboard URL your Admin shared with you.
2. Click **Connect Wallet** in the header.
3. When prompted, select **Freighter**.
4. Freighter will ask whether VaultDAO may access your public address. Click **Allow** / approve the connection.
5. After a successful connection, the header shows a shortened version of your address (for example `GABC…XYZ1`) and, when available, your role badge (**Admin**, **Treasurer**, or **Member**).

If Freighter is missing, VaultDAO may show a toast such as “No wallet selected. Please install Freighter, Albedo, or Rabet.” Install Freighter, refresh, and try **Connect Wallet** again.

**Mockup — Connected header:** Left side: VaultDAO logo and nav links (Overview, Proposals, Governance). Right side: a pill showing `GABC…XYZ1`, a small blue or purple role chip reading **Treasurer** or **Admin**, and a notification bell. That pill is your confirmation that the dashboard “sees” the same account Freighter is using.

### 1.3 Verify your address (do this every time you switch devices)

Your public address is the on-chain identity the vault trusts. Before you approve anything valuable, confirm Freighter and VaultDAO agree:

1. Open Freighter → copy your public key (starts with `G`).
2. Compare it character-by-character with the address shown in the VaultDAO header after **Connect Wallet**.
3. Ask your Admin (or check **Governance** / role management) that this exact address is listed as a signer or holds **Treasurer** / **Admin**.

Roles in the product (from Role Management):

| Role | What you can typically do |
| ---- | ------------------------- |
| **Member** | Limited participation; may view and, depending on vault policy, vote when listed as a signer. |
| **Treasurer** | Create and approve proposals. |
| **Admin** | Full control: manage signers, configuration, and spending limits, plus Treasurer permissions. |

If your address is wrong by even one character, you are looking at a different account. Do not approve. Disconnect, switch Freighter accounts, reconnect, and re-check.

**Mockup — Address check card:** A settings or profile panel titled “Connected account.” Two rows: **Wallet address** with a monospace `G…` string and a copy icon; **Role** with a colored badge (**Treasurer**). A subtle note: “This address must match Freighter and the on-chain signer list.”

### 1.4 Confirm you are allowed to sign

Being able to open the dashboard is not the same as being able to move treasury funds. Before your first real approval:

1. Open **Proposals** and find a **Pending** proposal (or ask Admin to create a tiny Testnet proposal).
2. Open it so the **Proposal Detail** modal appears (`ProposalDetailModal`).
3. Confirm the footer shows **Approve Proposal** and **Reject** (not only “Connect wallet to take action” or “Proposal is Executed”).
4. Confirm **Signing Progress** lists you among expected signers, or that **Approval History** will accept your signature once you approve.

If the footer says **Connect wallet to take action**, reconnect Freighter. If it says the proposal is already **Executed**, **Rejected**, or **Timelocked**, you are past the voting window for that item—look for another **Pending** proposal.

### 1.5 Safe setup habits

- Use a dedicated browser profile for treasury signing when possible.
- Keep Freighter locked when you step away.
- Prefer hardware-backed or cold workflows for very large vaults (see [Section 5](#5-emergency-and-qr-cold-storage-signing)).
- Never approve a proposal you have not opened and read in **Proposal Detail**.

---

## 2. Voting workflow

Voting in VaultDAO means reviewing a proposal’s facts, then either approving or rejecting it. The product surfaces those facts in the **Proposal Detail** modal and the embedded **Signature Flow**.

### 2.1 Find proposals that need your signature

1. From the dashboard, open **Proposals**.
2. Filter or scan for status **Pending** (yellow status chip in the detail modal). Other statuses you may see:
   - **Timelocked** — approvals met; waiting out the delay.
   - **Executed** — funds already moved (green chip).
   - **Rejected** — stopped (red chip).
3. Click a row to open **Proposal Detail** (`ProposalDetailModal`). The title reads **Proposal #** plus the ID (for example **Proposal #42**).

**Mockup — Proposals list:** A table with columns Proposal ID, Title/memo, Amount, Token, Status, Approvals. Pending rows show a yellow **Pending** badge and an approvals counter like `1/3`. Clicking a row opens a centered dark modal with a close (X) button.

### 2.2 Read the details tab carefully

Inside **Proposal Detail**, tabs include **Details** and **Comments**. Stay on **Details** until you understand the transfer.

Key sections and labels:

| Section label | What to check |
| ------------- | ------------- |
| **Signing Progress** | Progress through Review → Simulate → Sign (`SignatureFlow`). |
| **Signatures** | Who has signed; use **Refresh** if the list looks stale. |
| **Mobile Signing** | QR path for phones / air-gapped devices (`QRSignature`). |
| **Proposal Lifecycle** | Steps: **Created** → **Approvals** → **Timelock** → **Executed**. |
| **Draft History** | Prior draft snapshots if collaboration was used. |
| **Execution Phases** | Multi-step execution timeline when the proposal has phases. |
| **Proposer** / **Recipient** | Addresses with copy buttons. |
| **Approval History** | Counter like **`2/3 Confirmed`** and each approving address. |

Also verify amount, token (often `NATIVE` for XLM or a token code), and memo if shown on the proposal card or in **SignatureFlow**’s **Proposal Details** step.

### 2.3 Impact score — what the number means

When a proposal is created, the vault computes an **impact score** (0–100). It is a risk signal relative to treasury health, not a moral judgment. Components include:

- **Treasury impact** — how large the amount is versus vault balance.
- **Recipient risk** — lower for known/whitelisted recipients; higher for unknown addresses.
- **Complexity** — conditions, dependencies, scheduled execution, insurance/staking requirements.

The **total score** is a weighted blend of those parts. If the total is at or above the vault’s **high impact threshold** (configured by Admins, commonly around 70), the contract applies an **extended timelock** (extra delay, typically on the order of +48 hours of ledger time). That is intentional friction for large or complex moves.

**How to use it as a signer:** Treat a high impact score as a prompt to slow down. Re-check recipient, amount, attachments, and whether a phased or dependent proposal is required. Ask the Treasurer why the score is high before approving if anything is unclear.

**Mockup — Impact score callout:** A card titled “Impact score” with a large number `78 / 100`, a subtitle “High impact — extended timelock applies,” and three small meters: Treasury impact, Recipient risk, Complexity.

### 2.4 Dependencies

Some proposals cannot execute until other proposals succeed (dependency chains). In the detail view and related proposal metadata you may see dependency references or complexity driven by “depends on proposal X.”

Before approving:

1. Identify any parent or sibling proposals listed as dependencies.
2. Confirm those proposals are themselves legitimate and progressing.
3. Do not approve a dependent payout if the parent proposal looks wrong—fixing a dependent transfer can still lock governance attention and spending-limit budget depending on vault rules.

If you are unsure, leave a note in **Comments** and wait for Treasurer clarification.

### 2.5 Attachments and verifying IPFS content

Proposals can include file attachments stored on IPFS (content-addressed storage). In the UI, attachments show CIDs (content identifiers) such as `IPFS: bafybeig…` and can be opened in an attachment viewer.

When you open an attachment:

1. Confirm the file name matches what the proposer described (invoice PDF, board memo, etc.).
2. Wait for verification status:
   - **Verifying…** with a percent progress while the gateway downloads and hashes the file.
   - **✓ Verified** (green) when the content matches the expected integrity check.
   - **⚠ Integrity Failed** (red) if the hash does not match—**do not approve** until resolved.
   - Errors such as **Could not load file preview** or gateway failures: retry, try another gateway, or ask the proposer to re-upload.
3. For large files you may see **File too large for in-browser preview** with a **Download only** link—still verify offline if the transfer is material.
4. Prefer downloading from the official IPFS gateway configured for your deployment and comparing against the CID printed in the proposal.

**Mockup — Attachment panel:** Filename `Q3-vendor-invoice.pdf`, line `IPFS: bafybeig12ab…`, status badge **✓ Verified**, buttons to preview or **Download only**. A red **⚠ Integrity Failed** badge should feel like a hard stop.

Never treat an attachment as proof by itself. It supports the story; the on-chain recipient and amount are what Freighter will authorize.

### 2.6 Decide: approve, reject, or wait

- **Approve** only when recipient, amount, token, memo, impact, dependencies, and attachments all make sense.
- **Reject** when something is wrong and should not proceed (footer button **Reject** / **Rejecting…** while in progress).
- **Wait** if you need more information—use **Comments**, ping the proposer, or ask Admin. Silence is better than a rushed signature.

---

## 3. Signing step-by-step

This is the path from opening a proposal to seeing Stellar confirm your approval. Labels match `ProposalDetailModal`, `SignatureFlow`, and Freighter prompts.

### Step 1 — Open the proposal

Open **Proposals** → select a **Pending** item → **Proposal Detail** appears with title **Proposal #N** and status chip **Pending**.

### Step 2 — Review Signing Progress (`SignatureFlow`)

Near the top of the modal, under **Signing Progress**, the guided flow shows three steps:

1. **Review**
2. **Simulate**
3. **Sign**

The active step is highlighted (purple border / clock icon). Completed steps show a green check. Use **Next** to advance and **Back** to return. On the first step, **Back** cancels / closes per the flow’s cancel handler.

**Mockup — SignatureFlow stepper:** Three circles labeled **Review**, **Simulate**, **Sign**, connected by a progress line. Step 1 active. Below: a panel titled **Proposal Details** summarizing recipient, amount, token, and memo. Buttons: **Back** and **Next**.

### Step 3 — Review proposal facts

On **Review**, confirm:

- Recipient address (copy and compare to an invoice or known vendor address).
- Amount and token.
- Memo / purpose.
- That you have not already approved (the flow tracks `alreadyApproved`).

If anything looks off, click **Back** / close the modal and investigate—do not continue to **Sign**.

### Step 4 — Simulate (`TransactionSimulator`)

Click **Next** to reach **Simulate**. The simulator prepares an `approve_proposal` call so you can see whether the network would accept the approval before you spend a signature.

- Read any simulation warnings (insufficient rights, already approved, vault paused, spending limits, etc.).
- When comfortable, click **Proceed to Sign** (the simulator’s action label) or advance with **Next** as shown in your build.

**Mockup — Simulate panel:** Title “Transaction simulation.” Status “Success” or “Would fail.” Detail line “Function: approve_proposal.” Primary button **Proceed to Sign**; secondary **Cancel**.

### Step 5 — Click Approve Proposal (footer path)

Many signers use the modal footer instead of (or in addition to) the stepper:

1. Scroll to the footer while status is **Pending** and wallet is connected.
2. Click **Approve Proposal**.
3. The button shows a spinner and label **Approving…** while the request runs.
4. On failure, a red error line appears above the buttons and a toast may echo the message (for example wallet rejection or contract error).
5. On success, the modal closes and approvals update (after refresh, **Approval History** shows **`N/M Confirmed`**).

**Reject** remains available beside Approve for **Pending** proposals. It shows **Rejecting…** while processing.

### Step 6 — Confirm in Freighter

After you approve, Freighter opens a signing popup:

1. Read the summary: network, source account, and contract interaction.
2. Confirm you are still on the correct network (**PUBLIC** vs **TESTNET**).
3. Click Freighter’s approve / **Sign** control.
4. If you did not mean to sign, click decline / reject. VaultDAO will surface a **Transaction declined** style message and you can safely try again later.

**Mockup — Freighter sign dialog:** Header “Confirm Transaction.” Rows for Network, Account, and Operation (“Invoke contract” / approve proposal). Buttons **Reject** and **Approve**. Only click Approve when the dashboard proposal matches what you reviewed.

### Step 7 — Wait for Stellar confirmation

After Freighter returns a signature, VaultDAO submits the transaction to the Stellar / Soroban network:

1. Wait for the dashboard to update—do not double-click **Approve Proposal**.
2. Re-open the proposal if needed and click **Refresh** under **Signatures**.
3. Confirm your address appears in **Approval History** with a timestamp when available.
4. Watch **Signing Progress** / overall approvals. When the threshold is met (for example 3-of-5), the lifecycle moves toward **Timelock** and later **Executed**.

If the UI says **Proposal Approved** inside the Sign step of `SignatureFlow`, your approval succeeded for that session. Still verify on-chain status via **Refresh** and the status chip.

### Step 8 — After you sign

- You usually cannot “un-sign.” If the proposal is wrong, coordinate a **Reject** / cancel path with other signers before threshold is reached, or rely on timelock and Admin emergency procedures for severe issues.
- If threshold is met, expect a timelock delay—especially when impact score is high.
- Keep Freighter locked again when finished.

---

## 4. Delegation

Delegation lets you temporarily (or permanently) hand your voting power to another trusted address so governance does not stall while you are unavailable. Think of it as a limited power of attorney for voting—not a transfer of the vault’s funds to that person by default.

### 4.1 When to delegate

Good reasons:

- Travel or medical leave.
- Planned vacation when proposals will still need quorum.
- Temporary coverage between overlapping board terms.

Avoid delegating:

- To someone you do not personally trust with treasury votes.
- Indefinitely without a calendar reminder to review.
- In a long chain (VaultDAO limits delegation depth; excessively long chains are rejected).

### 4.2 How to delegate (operator view)

Exact menu labels can vary by dashboard version; the on-chain actions are:

1. Connect with the address that holds signing power.
2. Choose the **delegate** address (the person who will vote on your behalf).
3. Set an expiry:
   - Temporary: an expiry ledger / time window.
   - Permanent: expiry set to “no expiry” / `0` in contract terms—use only with strong trust.
4. Confirm the delegation transaction in Freighter.
5. Verify the active delegation (delegator, delegate, expiry, active flag).

When you later approve while a delegation is active, the effective voter recorded may be the delegate according to vault rules—confirm with your Admin how your vault displays this in **Approval History**.

### 4.3 Scope — what delegation does and does not do

**Typically does:**

- Allow the effective voter path to cast approvals / abstentions associated with your voting power.
- Keep an auditable history of who delegated to whom.

**Typically does not:**

- Give the delegate your Freighter keys.
- Automatically make them **Admin** for configuration changes (roles are separate).
- Bypass spending limits, timelocks, or circuit breakers.

Ask Admin whether your vault’s UI exposes **Delegate voting power** under Governance or Settings. If the button is not visible yet in your deployment, Admin may set delegation via an approved operations runbook / SDK flow—still require Freighter confirmation from the delegator.

### 4.4 How to revoke

1. Connect as the original delegator.
2. Submit **Revoke delegation** (on-chain `revoke_delegation`).
3. Confirm in Freighter.
4. Verify that effective voter returns to you and that the delegate can no longer vote in your place.

Revoke immediately if a laptop is lost, a relationship changes, or a delegate behaves unexpectedly. Revocation is one of the fastest containment tools you have short of removing a signer.

**Mockup — Delegation card:** Title “Voting delegation.” Status “Active → GDEF…9999.” Expiry “14 days.” Buttons **Edit** and **Revoke delegation**. Warning text: “Delegates can approve proposals with your voting power until you revoke.”

---

## 5. Emergency and QR cold-storage signing

For high-value vaults, some signers keep keys on air-gapped or mobile devices. VaultDAO supports a **Mobile Signing** path via `QRSignature`.

### 5.1 Where to find QR signing

In **Proposal Detail**:

- Desktop: section **Mobile Signing** shows the QR panel directly.
- Narrow / mobile layout: button **Show QR Code** / **Hide QR Code** toggles the same panel.

The panel title inside `QRSignature` is **Mobile Signing**. Helper text reads: **Scan with your air-gapped device to sign proposal #N**.

### 5.2 Standard QR flow (online companion + offline signer)

1. On the internet-connected computer, open the proposal and reveal **Mobile Signing**.
2. Optionally advance `SignatureFlow` to the **Sign** step so an unsigned payload / XDR is available for chunked QR display.
3. On the air-gapped device, open your approved signing app and scan the QR.
4. If the payload is long, the UI cycles chunks (**Chunk 1 of N**, **Chunk 2 of N**, …). Scan each chunk as your device requires.
5. The offline device signs and displays a **signed** QR.
6. Back on the connected computer, use **Scan Signed QR from Device** (or your deployment’s camera import) to submit the signed payload.
7. Wait until the panel shows **Signed successfully** (green check).
8. Click **Refresh** under **Signatures** to confirm the on-chain approval.

**Mockup — QR panel:** White QR square on a dark card. Caption “Scan with your air-gapped device to sign proposal #42.” Below: “Chunk 2 of 5.” Full-width button **Scan Signed QR from Device**. After success: large green check and **Signed successfully**.

### 5.3 Emergency use cases

Use QR / cold signing when:

- Policy requires air-gapped approval above a dollar threshold.
- Your primary laptop Freighter install is unavailable but a cold device is ready.
- Incident response: approve a pause, cancel, or corrective proposal without exposing hot keys.

Emergency hygiene:

- Verify proposal ID on both screens before scanning.
- Prefer known-good devices imaged by your security team.
- After an emergency session, revoke any temporary delegations and rotate compromised hot wallets.

### 5.4 If QR signing fails

- Click the refresh icon on the **Mobile Signing** card and reload chunks.
- Confirm the proposal is still **Pending** and threshold not already met.
- Ensure the companion app expects the same network and contract.
- Fall back to Freighter on a secure online machine if policy allows.
- Contact Admin / Security Officer if integrity checks or submission fail repeatedly.

---

## 6. FAQ

### Q1. Freighter is installed but VaultDAO still says connect wallet. What now?

Unlock Freighter, confirm the extension is enabled for the site, click **Connect Wallet**, and choose Freighter. If you previously clicked deny, open Freighter’s connected apps settings, remove VaultDAO, and connect again. Check that you are not in a private window that blocks extensions.

### Q2. Why does Freighter say I’m on the wrong network?

VaultDAO and Freighter must share the same network. Switch Freighter to **TESTNET** or **PUBLIC** as instructed by your Admin, refresh the dashboard, and reconnect. Approving on the wrong network either fails or (worse) signs against a different deployment.

### Q3. I clicked Approve Proposal but nothing happened.

Check for a Freighter popup behind other windows. If you declined, you will see a declined/rejected message—try again and approve in Freighter. If an on-chain error appears (already approved, vault paused, not a signer), read the toast and ask Admin. Avoid double-submitting; use **Refresh** under **Signatures** to see whether your approval already landed.

### Q4. What do Review, Simulate, and Sign mean in Signing Progress?

They are the three steps of `SignatureFlow`. **Review** is human checking. **Simulate** dry-runs the approval. **Sign** collects the cryptographic approval (Freighter or QR). You should not skip reading **Review** even if you are comfortable with wallets.

### Q5. Can I approve from my phone?

Yes, via **Mobile Signing** / QR (`QRSignature`), or by using a mobile-capable Stellar wallet flow your organization supports. On small screens, tap **Show QR Code** inside **Proposal Detail**. Prefer organization-approved apps only.

### Q6. Someone else approved as me — is that possible?

If you delegated voting power, the effective voter may be your delegate. Check active delegations and **Approval History**. If you did not delegate and see unexpected approvals, contact Security Officer immediately, revoke delegations, and consider rotating signers.

### Q7. What if the IPFS attachment shows Integrity Failed?

Do not approve. Ask the proposer to re-upload, confirm the CID, and re-verify until you see **✓ Verified**. An integrity failure means the file bytes do not match what the proposal claims.

### Q8. I approved by mistake. Can I undo it?

Generally no. Contact other signers before threshold is reached and pursue **Reject** / cancel procedures. If threshold and timelock already passed, escalate to Admin for emergency controls and incident response. This is why Review and Simulate exist.

---

## 7. Quick reference checklist

Print or keep this beside your signing machine:

- [ ] Freighter unlocked on the correct network
- [ ] VaultDAO header address matches Freighter
- [ ] Role is **Treasurer** / **Admin** / authorized signer as expected
- [ ] Proposal status is **Pending**
- [ ] Recipient, amount, token, memo verified
- [ ] Impact score understood; high impact → extra caution
- [ ] Dependencies reviewed
- [ ] Attachments show **✓ Verified** (or consciously accepted offline review)
- [ ] `SignatureFlow`: **Review** → **Simulate** → **Sign** completed thoughtfully
- [ ] Freighter confirmation matches the proposal
- [ ] **Signatures** / **Approval History** refreshed after submit
- [ ] Freighter locked when finished

---

## Glossary (plain language)

| Term | Meaning |
| ---- | ------- |
| **Signer** | An address allowed to approve vault proposals. |
| **Threshold** | How many approvals are required (for example 3 of 5). |
| **Timelock** | Mandatory waiting period after approvals before execution. |
| **Freighter** | Browser extension that holds keys and confirms transactions. |
| **IPFS** | Decentralized file storage addressed by content hash (CID). |
| **Delegation** | Letting another address vote with your voting power. |
| **QR / Mobile Signing** | Approving via scanned codes with an air-gapped device. |

---

*Document owner: Treasury operations. For contract-level behavior see `docs/reference/ARCHITECTURE.md` and `docs/reference/SECURITY.md`. For developer wallet wiring see `docs/guides/WALLET_INTEGRATION.md`.*
