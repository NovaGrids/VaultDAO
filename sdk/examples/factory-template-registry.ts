/**
 * Example: Vault Factory & Template Registry (Register, Verify, Deploy)
 *
 * Demonstrates the end-to-end Issue #2230 workflow:
 * 1. Computing a canonical license hash and maintainer Ed25519 attestation
 * 2. Registering a pinned template version with an upgradeable preset
 * 3. Fetching and verifying registry metadata off-chain before deployment
 * 4. Deploying a new vault from the registered WASM hash
 * 5. Reading on-chain factory + template provenance from the deployed vault
 *
 * Prerequisites:
 *   - npm install @vaultdao/sdk
 *   - Replace FACTORY_CONTRACT_ID, keys, and WASM_HASH_HEX below
 */

import { Keypair } from "@stellar/stellar-sdk";
import {
  buildOptions,
  computeLicenseHash,
  signTemplateAttestation,
  registerFactoryTemplate,
  getFactoryPolicy,
  getFactoryTemplate,
  verifyRegistryMetadata,
  deployVault,
  getFactoryProvenance,
  signAndSubmit,
  type VaultTemplatePreset,
} from "../src/index";

const FACTORY_CONTRACT_ID =
  "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const MAINTAINER_SECRET =
  "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const DEPLOYER_PUBLIC_KEY =
  "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SIGNER_2_PUBLIC_KEY =
  "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";
const WASM_HASH_HEX = "ab".repeat(32);

const LICENSE_TEXT = "SPDX-License-Identifier: AGPL-3.0-only\n";
const LICENSE_URI = "https://spdx.org/licenses/AGPL-3.0-only.html";
const PARAMS_SCHEMA = "https://schemas.vaultdao.org/treasury-v1.json";

const STANDARD_PRESET: VaultTemplatePreset = {
  version: 1,
  thresholdRatioPercent: 67,
  quorumPercentage: 60,
  timelockDelayLedgers: BigInt(100),
  timelockThresholdPct: 50,
  vetoWindowLedgers: BigInt(200),
  dailyLimitRatioPercent: 400,
  weeklyLimitRatioPercent: 900,
  feeTiers: [],
  baseFeeBps: 25,
  enabledFeatures: 0b0011, // WHITELIST_MODE | RETRY
  gracePeriodLedgers: BigInt(150),
  voteWeight: "Flat",
  highImpactThreshold: 70,
  adminRotationDelay: BigInt(1440),
};

async function main() {
  const factoryOpts = buildOptions("testnet", FACTORY_CONTRACT_ID);
  const maintainerKp = Keypair.fromSecret(MAINTAINER_SECRET);
  const wasmHash = new Uint8Array(Buffer.from(WASM_HASH_HEX, "hex"));
  const licenseHash = computeLicenseHash(LICENSE_TEXT);

  // 1. Maintainer signs canonical attestation payload
  const attestationSig = signTemplateAttestation(
    {
      templateId: "treasury-standard",
      version: 1,
      wasmHash,
      paramsSchema: PARAMS_SCHEMA,
      licenseUri: LICENSE_URI,
      licenseHash,
    },
    maintainerKp
  );

  // 2. Register pinned template version in the factory registry
  const registerXdr = await registerFactoryTemplate(
    {
      caller: maintainerKp.publicKey(),
      templateId: "treasury-standard",
      version: 1,
      wasmHash,
      paramsSchema: PARAMS_SCHEMA,
      licenseUri: LICENSE_URI,
      licenseHash,
      preset: STANDARD_PRESET,
      attestationSig,
    },
    factoryOpts
  );
  console.log("Prepared register_factory_template XDR:", registerXdr.slice(0, 48));
  await signAndSubmit(registerXdr, factoryOpts);

  // 3. Before deploying, fetch policy + template and verify metadata off-chain
  const policy = await getFactoryPolicy(DEPLOYER_PUBLIC_KEY, factoryOpts);
  const record = await getFactoryTemplate(
    "treasury-standard",
    1,
    DEPLOYER_PUBLIC_KEY,
    factoryOpts
  );

  const verification = verifyRegistryMetadata(record, {
    maintainerPubkey: policy.maintainerPubkey,
    requireAttestation: policy.requireAttestation,
    expectedWasmHash: wasmHash,
    expectedLicenseText: LICENSE_TEXT,
  });

  if (!verification.valid) {
    throw new Error(
      `Refusing to deploy unverified template: ${verification.errors.join("; ")}`
    );
  }
  console.log("Template verified! Attested:", verification.attested);

  // 4. Deploy a new vault from the verified template WASM hash
  const salt = new Uint8Array(32).fill(7);
  const deployXdr = await deployVault(
    {
      deployer: DEPLOYER_PUBLIC_KEY,
      templateId: "treasury-standard",
      version: 1,
      salt,
      vaultAdmin: DEPLOYER_PUBLIC_KEY,
      signers: [DEPLOYER_PUBLIC_KEY, SIGNER_2_PUBLIC_KEY],
      baseSpendingLimit: BigInt(10_000_000),
    },
    factoryOpts
  );
  console.log("Prepared deploy_vault XDR:", deployXdr.slice(0, 48));
  const deployed = await signAndSubmit(deployXdr, factoryOpts);

  // 5. Inspect on-chain factory provenance on the newly deployed vault
  if (typeof deployed.result === "string") {
    const vaultOpts = buildOptions("testnet", deployed.result);
    const provenance = await getFactoryProvenance(
      DEPLOYER_PUBLIC_KEY,
      vaultOpts
    );
    console.log("Deployed vault provenance:", provenance);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
