# Adding a Community Vault Template Safely

This guide explains how to author, register, attest, and maintain community vault templates in `VaultFactory` (`contracts/vault/src/factory.rs`) using `@vaultdao/sdk`.

## Overview

`VaultFactory` pins every template by an immutable `(template_id, version)` pair pointing to:

- **`wasm_hash`**: The 32-byte SHA-256 hash of the uploaded Soroban contract WASM binary.
- **`params_schema`**: A JSON Schema document or immutable URI describing valid initialization parameters.
- **`license_uri` & `license_hash`**: A canonical license reference (e.g., SPDX URL or IPFS CID) paired with the SHA-256 digest of the exact license text.
- **`preset` (upgradeable)**: An optional `VaultTemplate` ratio-based configuration preset (threshold ratio, quorum, timelock, spending limit ratios, enabled features). Presets can be upgraded via `upgrade_template_preset` without altering the pinned `wasm_hash` or license.
- **`attestation_sig` (optional)**: An Ed25519 signature from the factory's configured `maintainer_pubkey` over the canonical attestation payload.

When the factory policy sets `require_attestation = true`, `deploy_vault` rejects any unknown (`TemplateNotFound`), deprecated (`TemplateInactive`), or unattested (`TemplateNotAttested`) template.

## Security Checklist Before Submission

Before submitting a community template for registration and maintainer attestation, verify every item below:

1. **Deterministic WASM build**: Build with a pinned Rust toolchain (`wasm32-unknown-unknown`) and publish the exact commit SHA + build flags so maintainers can reproduce `wasm_hash`.
2. **Minimum upgrade timelock & safe ratios**:
   - `threshold_ratio_percent` must be in `1..=100` (and deployed vaults enforce a minimum threshold of 2 signers).
   - `quorum_percentage` and `high_impact_threshold` must be in `0..=100`.
   - Never hardcode signer addresses, oracle keys, or absolute token amounts inside a `VaultTemplate` preset.
3. **Implements `initialize_from_factory`**:
   - Your vault contract must expose `initialize_from_factory(...)`, record `FactoryProvenance`, and emit the `factory_template_version` event so indexers and auditors can verify which factory and template version created each vault.
4. **Canonical license pinning**:
   - Choose an OSI-approved license (e.g., `AGPL-3.0-only`, `MIT`, `Apache-2.0`).
   - Compute `license_hash = SHA-256(canonical_license_text)` using `computeLicenseHash()` from `@vaultdao/sdk`.
5. **Version immutability**:
   - Never reuse a `(template_id, version)` pair. Increment `version` monotonically for any WASM, schema, or license change.

## Step-by-Step Workflow

### 1. Upload the Vault WASM Binary

Upload the compiled WASM to Soroban and record the 32-byte WASM hash:

```bash
stellar contract install \
  --wasm contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm \
  --source <UPLOADER_ACCOUNT> \
  --network testnet
```

### 2. Register the Template (Unattested Staging)

Contributors can register a community template without a maintainer signature first (`attestationSig: null`). While `require_attestation` is enabled on the factory, the template is stored on-chain for review but cannot be deployed yet:

```ts
import {
  buildOptions,
  computeLicenseHash,
  registerFactoryTemplate,
  signAndSubmit,
} from "@vaultdao/sdk";

const opts = buildOptions("testnet", FACTORY_CONTRACT_ID);
const licenseHash = computeLicenseHash(LICENSE_TEXT);

const xdr = await registerFactoryTemplate(
  {
    caller: contributorPublicKey,
    templateId: "community-grants-v1",
    version: 1,
    wasmHash,
    paramsSchema: "https://schemas.vaultdao.org/community-grants-v1.json",
    licenseUri: "https://spdx.org/licenses/MIT.html",
    licenseHash,
    preset,
    attestationSig: null,
  },
  opts
);

await signAndSubmit(xdr, opts);
```

### 3. Maintainer Review & Ed25519 Attestation

Maintainers reproduce the WASM hash, audit the contract diff and preset ratios, and verify the license hash. Once approved, a maintainer signs the canonical payload:

```
"VAULTDAO_TEMPLATE_ATTESTATION_V1"
  || XDR(template_id)
  || BE_U32(version)
  || wasm_hash (32 bytes)
  || XDR(params_schema)
  || XDR(license_uri)
  || license_hash (32 bytes)
```

Using the SDK:

```ts
import { Keypair } from "@stellar/stellar-sdk";
import {
  signTemplateAttestation,
  attestFactoryTemplate,
  signAndSubmit,
} from "@vaultdao/sdk";

const maintainerKp = Keypair.fromSecret(MAINTAINER_SECRET);
const sig = signTemplateAttestation(
  {
    templateId: "community-grants-v1",
    version: 1,
    wasmHash,
    paramsSchema: "https://schemas.vaultdao.org/community-grants-v1.json",
    licenseUri: "https://spdx.org/licenses/MIT.html",
    licenseHash,
  },
  maintainerKp
);

const xdr = await attestFactoryTemplate(
  maintainerKp.publicKey(),
  "community-grants-v1",
  1,
  sig,
  opts
);
await signAndSubmit(xdr, opts);
```

### 4. Verify Before Deploying

Deployers should always verify registry metadata off-chain before calling `deployVault`:

```ts
import {
  getFactoryPolicy,
  getFactoryTemplate,
  verifyRegistryMetadata,
  deployVault,
} from "@vaultdao/sdk";

const policy = await getFactoryPolicy(deployerKey, opts);
const record = await getFactoryTemplate("community-grants-v1", 1, deployerKey, opts);

const check = verifyRegistryMetadata(record, {
  maintainerPubkey: policy.maintainerPubkey,
  requireAttestation: policy.requireAttestation,
  expectedWasmHash: wasmHash,
  expectedLicenseText: LICENSE_TEXT,
});

if (!check.valid) {
  throw new Error(`Template verification failed: ${check.errors.join("; ")}`);
}
```

See [sdk/examples/factory-template-registry.ts](../../sdk/examples/factory-template-registry.ts) for a complete runnable example.

## Upgrading Presets vs. Deprecating Versions

- **Preset-only tweaks** (e.g., tightening default timelock or quorum ratios): Call `upgrade_template_preset` as the factory admin. This increments `preset_revision` while keeping `wasm_hash`, `version`, `license_hash`, and `attested` unchanged.
- **Security vulnerability or breaking WASM change**: Call `deprecate_factory_template` on the affected `(template_id, version)` to immediately block new deployments (`TemplateInactive`), then register and attest `version + 1` with the patched WASM hash.
