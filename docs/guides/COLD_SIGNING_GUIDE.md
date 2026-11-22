# Cold Storage Signing Guide

This guide explains how to approve vault proposals using an **air-gapped cold signer**. Cold signing lets a key that never touches a networked machine authorize a proposal: you build the payload offline, sign it on the air-gapped machine, then submit the resulting Ed25519 signature from an online machine via `approve_with_cold_sig` (or `submit_cold_signature`).

If you are looking for online (hot-wallet) signing, see [SIGNING_GUIDE.md](./SIGNING_GUIDE.md).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Payload Serialization Format](#3-payload-serialization-format)
4. [Step-by-Step: Signing on an Air-Gapped Machine](#4-step-by-step-signing-on-an-air-gapped-machine)
5. [Step-by-Step: Submitting the Signature](#5-step-by-step-submitting-the-signature)
6. [Worked Example with stellar-sdk CLI Tools](#6-worked-example-with-stellar-sdk-cli-tools)
7. [Troubleshooting](#7-troubleshooting)
8. [Security Checklist](#8-security-checklist)

---

## 1. Overview

Cold storage signing separates two machines:

- **Air-gapped (offline) machine** — holds the cold private key. It only ever sees the proposal payload and produces a 64-byte Ed25519 signature.
- **Online machine** — holds no cold secrets. It builds the payload, carries it to the air-gapped machine (e.g. via USB or QR), carries the signature back, and submits it to the vault contract.

The vault contract enforces two protections on cold signatures:

- **Max age** — a cold signature is only valid for a bounded number of ledgers after its `created_at` ledger. A signature whose age equals the limit is accepted; one ledger past the limit is rejected with `ColdSignatureTooOld`.
- **Replay protection** — each cold signature can be used at most once. Re-submitting the same signature is rejected (the signature is recorded as used, `ColdSigUsed`).

The relevant contract entry points are:

| Function | Purpose |
| --- | --- |
| `configure_cold_signers` | Register the cold signer public key(s) and max-age policy. Must be called before any cold signature is accepted. |
| `submit_cold_signature` | Submit a cold signature for a proposal. |
| `approve_with_cold_sig` | Approve a proposal using a cold signature (convenience wrapper that submits and records approval). |

> **Note:** Read `contracts/vault/src/lib.rs` and `contracts/vault/src/types.rs` in your deployment for the exact argument order and the `ColdSignerConfig` fields, since these can vary by contract version. The examples below reflect the current interface.

---

## 2. Prerequisites

- A Soroban/Stellar CLI (`stellar`) installed on the online machine.
- The vault contract ID.
- The cold signer's **public key** (32-byte Ed25519 public key, hex-encoded).
- The cold signer's **private key** available only on the air-gapped machine.
- The cold signer must already be registered via `configure_cold_signers` (see [Troubleshooting → ColdSignerConfigNotSet](#71-coldsignatureconfignotset--coldsignerconfignotset)).
- A way to transfer data between machines (USB drive, QR codes, or printed hex).

---

## 3. Payload Serialization Format

The cold signature is an Ed25519 signature over a deterministic byte payload. Both machines must construct **exactly** the same bytes, or the signature will not verify.

### 3.1 Field order

The payload is the concatenation of the following fields, in this exact order, with no separators or padding:

| Offset | Length | Field | Encoding |
| --- | --- | --- | --- |
| 0 | 32 | `proposal_hash` | `BytesN<32>` — the proposal's on-chain hash |
| 32 | 4 | `created_at` | `u32` — the ledger sequence at which the signature was created, **big-endian** |
| 36 | 32 | `pubkey` | `BytesN<32>` — the cold signer's Ed25519 public key |
| 68 | 32 | `contract_id` | `BytesN<32>` — the vault contract ID (domain separation) |

Total payload length: **100 bytes**.

```
payload = proposal_hash (32) || created_at_be (4) || pubkey (32) || contract_id (32)
```

### 3.2 Encoding notes

- **`proposal_hash`** is a `BytesN<32>`. On-chain it is the 32-byte proposal hash. Off-chain, obtain it from the proposal (see the worked example) and pass it as raw bytes.
- **`created_at`** is a `u32` ledger sequence encoded **big-endian** (4 bytes). This is the ledger at which you intend the signature to be considered created. It must be close to the current ledger when submitted (see [max age](#72-coldsignaturetooold--coldsignaturetooold)).
- **`pubkey`** is the 32-byte Ed25519 public key, raw bytes (not base32/StrKey).
- **`contract_id`** is the 32-byte contract ID, raw bytes. Including it prevents a signature produced for one vault from being replayed against another.
- **The signature itself** is a `BytesN<64>` — the standard 64-byte Ed25519 signature (`R || S`).

### 3.3 Including `created_at`

`created_at` is part of the signed payload, so it cannot be altered after signing. When you submit, you pass the same `created_at` value you signed over. The contract computes `current_ledger - created_at` and compares it to the configured max age:

- `age <= max_age` → accepted (the boundary is **inclusive**).
- `age > max_age` (i.e. one ledger past the limit) → rejected with `ColdSignatureTooOld`.

Because `created_at` is signed, an attacker cannot take an old signature and "refresh" it — changing `created_at` invalidates the signature.

---

## 4. Step-by-Step: Signing on an Air-Gapped Machine

### Step 1 — Build the payload on the online machine

On the online machine, assemble the 100-byte payload described in [Section 3](#3-payload-serialization-format). The worked example in [Section 6](#6-worked-example-with-stellar-sdk-cli-tools) shows a scripted way to do this. Save it as a file, e.g. `payload.bin`.

### Step 2 — Transfer the payload to the air-gapped machine

Copy `payload.bin` to removable media (USB, or encode as hex/QR). Verify the transfer with a checksum:

```bash
sha256sum payload.bin
```

Record the checksum and confirm it matches on the air-gapped machine.

### Step 3 — Sign the payload with the cold key

On the air-gapped machine, sign the raw 100-byte payload with the cold Ed25519 private key. The output must be the raw **64-byte** signature. Using the `stellar` CLI:

```bash
# On the air-gapped machine:
stellar keys sign \
  --secret-key "$COLD_SECRET_KEY" \
  --payload-file payload.bin \
  --raw \
  --out signature.bin
```

> The exact flags depend on your CLI version. The requirement is: **Ed25519 signature over the raw payload bytes, output as 64 raw bytes** (not base64, not StrKey). If your tool outputs hex, convert it to raw bytes with `xxd -r -p signature.hex signature.bin`.

Verify the signature locally before leaving the air-gapped machine:

```bash
stellar keys verify \
  --public-key "$COLD_PUBLIC_KEY" \
  --payload-file payload.bin \
  --signature-file signature.bin
```

### Step 4 — Copy the 64-byte signature out

Copy `signature.bin` (exactly 64 bytes) back to the online machine. Confirm the length:

```bash
wc -c signature.bin   # must print 64
```

You now have everything needed to submit: the `proposal_id`, the `signature` (64 bytes), the `pubkey` (32 bytes), and the `created_at` ledger you signed over.

---

## 5. Step-by-Step: Submitting the Signature

On the online machine, call the vault contract. The two entry points are:

### 5.1 `submit_cold_signature`

```text
submit_cold_signature(
    proposal_id: u64,
    signature: BytesN<64>,
    pubkey: BytesN<32>,
    created_at: u32,
)
```

This records the cold signature against the proposal. The contract will:

1. Look up the `ColdSignerConfig` for `pubkey`. If none is configured → `ColdSignerConfigNotSet`.
2. Recompute the payload from `proposal_hash`, `created_at`, `pubkey`, and `contract_id`.
3. Verify the Ed25519 signature.
4. Check `current_ledger - created_at <= max_age`. If not → `ColdSignatureTooOld`.
5. Check the signature has not been used before. If it has → replay rejection (`ColdSigUsed`).
6. Mark the signature as used and record it.

### 5.2 `approve_with_cold_sig`

```text
approve_with_cold_sig(
    proposal_id: u64,
    signature: BytesN<64>,
    pubkey: BytesN<32>,
    created_at: u32,
)
```

This is the convenience path: it performs the same validation as `submit_cold_signature` and then records the cold signer's approval on the proposal. Use this when the cold signer's approval is what you want to register.

### 5.3 Argument summary

| Argument | Type | Value |
| --- | --- | --- |
| `proposal_id` | `u64` | The proposal being approved |
| `signature` | `BytesN<64>` | Raw 64-byte Ed25519 signature from the air-gapped machine |
| `pubkey` | `BytesN<32>` | Cold signer public key (must match a configured cold signer) |
| `created_at` | `u32` | The ledger sequence you signed over (must match the payload) |

Submit promptly after signing: the signature is only valid while `current_ledger - created_at <= max_age`.

---

## 6. Worked Example with stellar-sdk CLI Tools

This end-to-end example approves proposal `42` on a vault. Replace the placeholder values with your own.

### 6.1 Setup (online machine)

```bash
export VAULT_CONTRACT_ID="C...your-vault-contract-id..."
export COLD_PUBLIC_KEY="<64-hex-chars>"      # 32-byte Ed25519 public key, hex
export PROPOSAL_ID=42
export NETWORK="testnet"
```

### 6.2 Fetch the proposal hash and current ledger

```bash
# Current ledger sequence (used as created_at)
export CREATED_AT=$(stellar ledger latest --network "$NETWORK" --format json | jq -r '.sequence')
echo "created_at = $CREATED_AT"

# Proposal hash (32 bytes, hex) — adjust the invocation to your vault's read method
export PROPOSAL_HASH_HEX=$(stellar contract invoke \
  --id "$VAULT_CONTRACT_ID" \
  --network "$NETWORK" \
  -- get_proposal_hash --proposal_id "$PROPOSAL_ID" | jq -r '.')
echo "proposal_hash = $PROPOSAL_HASH_HEX"
```

### 6.3 Build the 100-byte payload

```bash
# contract_id as 32 raw bytes (hex)
export CONTRACT_ID_HEX=$(stellar contract id decode "$VAULT_CONTRACT_ID" --hex)

# created_at as 4-byte big-endian hex
export CREATED_AT_BE=$(printf '%08x' "$CREATED_AT")

# Concatenate: proposal_hash || created_at_be || pubkey || contract_id
echo -n "${PROPOSAL_HASH_HEX}${CREATED_AT_BE}${COLD_PUBLIC_KEY}${CONTRACT_ID_HEX}" \
  | xxd -r -p > payload.bin

wc -c payload.bin   # must print 100
sha256sum payload.bin
```

### 6.4 Sign on the air-gapped machine

Transfer `payload.bin` to the air-gapped machine, then:

```bash
# Air-gapped machine
export COLD_SECRET_KEY="S...your-cold-secret..."
stellar keys sign \
  --secret-key "$COLD_SECRET_KEY" \
  --payload-file payload.bin \
  --raw \
  --out signature.bin

wc -c signature.bin   # must print 64
stellar keys verify \
  --public-key "$COLD_PUBLIC_KEY" \
  --payload-file payload.bin \
  --signature-file signature.bin
```

Transfer `signature.bin` back to the online machine.

### 6.5 Submit via the CLI

Convert the raw bytes to the hex form the CLI expects for `BytesN` arguments:

```bash
export SIG_HEX=$(xxd -p -c 256 signature.bin)
export PUBKEY_HEX="$COLD_PUBLIC_KEY"

stellar contract invoke \
  --id "$VAULT_CONTRACT_ID" \
  --network "$NETWORK" \
  --source "$OPERATOR_KEY" \
  -- approve_with_cold_sig \
  --proposal_id "$PROPOSAL_ID" \
  --signature "$SIG_HEX" \
  --pubkey "$PUBKEY_HEX" \
  --created_at "$CREATED_AT"
```

To only record the signature without approving, swap `approve_with_cold_sig` for `submit_cold_signature` with the same arguments.

### 6.6 Verify

```bash
stellar contract invoke \
  --id "$VAULT_CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_approved --proposal_id "$PROPOSAL_ID"
```

A successful submission returns without error and the proposal reflects the cold signer's approval.

---

## 7. Troubleshooting

### 7.1 `ColdSignatureConfigNotSet` / `ColdSignerConfigNotSet`

**Symptom:** Submission fails because no cold signer configuration exists for the supplied `pubkey`.

**Cause:** `configure_cold_signers` was never called, or the `pubkey` you submitted does not match any configured cold signer.

**Fix:**
- Confirm the cold signer is registered. Check that the `pubkey` you pass is byte-for-byte identical to the configured key (raw 32 bytes, not StrKey/base32).
- If not configured, register it (admin only):

```bash
stellar contract invoke \
  --id "$VAULT_CONTRACT_ID" \
  --network "$NETWORK" \
  --source "$ADMIN_KEY" \
  -- configure_cold_signers \
  --signers "[\"$COLD_PUBLIC_KEY\"]" \
  --max_age_ledgers 100
```

> The exact argument names and the `ColdSignerConfig` fields are defined in `contracts/vault/src/types.rs`. Verify `max_age_ledgers` (or equivalent) against your contract version.

### 7.2 `ColdSignatureTooOld` / `ColdSignatureTooOld`

**Symptom:** Submission fails with `ColdSignatureTooOld`.

**Cause:** The signature's age exceeded the configured max age. The contract computes `age = current_ledger - created_at` and requires `age <= max_age`. The boundary is **inclusive**: a signature exactly at the limit is accepted; **one ledger past** the limit is rejected.

**Fix:**
- Submit sooner after signing. The gap between building the payload and submitting must stay within `max_age` ledgers.
- If the signature is stale, rebuild the payload with a fresh `created_at` (current ledger) and re-sign on the air-gapped machine. You cannot reuse the old signature with a new `created_at` — `created_at` is part of the signed payload.
- If your workflow legitimately needs more time, ask the admin to raise `max_age_ledgers` via `configure_cold_signers` (subject to the contract's own limits).

### 7.3 Replay rejection (`ColdSigUsed`)

**Symptom:** Submission fails because the signature was already used.

**Cause:** Each cold signature is single-use. The contract records used signatures and rejects any resubmission of the same `(signature, pubkey, created_at)` tuple. This protects against replay even within the max-age window.

**Fix:**
- Do not resubmit a signature that has already been accepted. If you need to approve again (e.g. a retry after an unrelated failure), produce a **new** signature: rebuild the payload (you may keep the same `created_at` if still within max age, but the contract treats the resulting signature as distinct only if the signed bytes differ — in practice, re-sign with a fresh `created_at` to be safe).
- If you suspect a signature was replayed by someone else, treat the cold key as potentially compromised and rotate it via `configure_cold_signers`.

### 7.4 Signature verification fails (no specific error)

**Symptom:** The contract rejects the signature as invalid.

**Cause:** The payload bytes on the signing machine did not match what the contract reconstructs.

**Fix:** Check each field:
- `proposal_hash` — correct 32 bytes for the proposal.
- `created_at` — encoded big-endian, 4 bytes, and the same value passed to the contract.
- `pubkey` — raw 32 bytes, matching the configured key.
- `contract_id` — the vault's 32-byte contract ID, not a StrKey string.
- Signature length — exactly 64 raw bytes (not hex, not base64).

Recompute `sha256sum payload.bin` on both machines and confirm they match.

---

## 8. Security Checklist

- [ ] The cold private key never leaves the air-gapped machine.
- [ ] Payload checksums are verified across the air gap.
- [ ] The signature is exactly 64 raw bytes before submission.
- [ ] `created_at` is the current ledger at signing time, and submission happens well within `max_age`.
- [ ] Each signature is used exactly once; re-sign rather than resubmit.
- [ ] The `pubkey` submitted matches a key registered via `configure_cold_signers`.
- [ ] Rotate the cold key immediately if a signature is unexpectedly rejected as replayed.

---

For online signing workflows, see [SIGNING_GUIDE.md](./SIGNING_GUIDE.md).