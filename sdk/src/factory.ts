/**
 * VaultDAO SDK — Vault Factory & Template Registry Helpers (Issue #2230)
 *
 * Provides typed Soroban bindings and off-chain verification utilities for:
 * - Registering pinned template versions (WASM hash, params schema, license URI/hash, presets)
 * - Signing & verifying optional Ed25519 maintainer attestations
 * - Upgrading template configuration presets without changing pinned WASM hashes
 * - Deploying vaults from registered template WASM hashes
 * - Inspecting factory + template version provenance on deployed vaults
 */

import { Keypair, StrKey, hash as stellarSha256, xdr } from "@stellar/stellar-sdk";
import type { SdkOptions } from "./types";
import {
  getContract,
  buildTransaction,
  addressToScVal,
  boolToScVal,
  i128ToScVal,
  u32ToScVal,
  u64ToScVal,
  vecToScVal,
  structToScVal,
  enumToScVal,
} from "./utils";
import { simulateReadOnly } from "./contract";
import {
  SdkValidationError,
  validateAddressList,
  validateNonEmptyString,
  validatePositiveBigInt,
  validatePositiveNumber,
} from "./validation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Domain separation prefix for canonical template attestation signatures.
 * Must stay byte-for-byte identical to `ATTESTATION_DOMAIN` in
 * `contracts/vault/src/factory.rs`.
 */
export const ATTESTATION_DOMAIN = "VAULTDAO_TEMPLATE_ATTESTATION_V1";

const UTF8_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactoryPolicy {
  admin: string;
  maintainerPubkey: Uint8Array;
  requireAttestation: boolean;
}

export interface TemplateFeeTier {
  volumeThresholdRatioPercent: number;
  feeBps: number;
}

export type VoteWeightModel = "Flat" | "TokenWeighted" | "ReputationWeighted";

export interface VaultTemplatePreset {
  version: number;
  thresholdRatioPercent: number;
  quorumPercentage: number;
  timelockDelayLedgers: bigint;
  timelockThresholdPct: number;
  vetoWindowLedgers: bigint;
  dailyLimitRatioPercent: number;
  weeklyLimitRatioPercent: number;
  feeTiers: TemplateFeeTier[];
  baseFeeBps: number;
  enabledFeatures: number;
  gracePeriodLedgers: bigint;
  voteWeight: VoteWeightModel;
  highImpactThreshold: number;
  adminRotationDelay: bigint;
}

export interface TemplateVersionRecord {
  templateId: string;
  version: number;
  wasmHash: Uint8Array;
  paramsSchema: string;
  licenseUri: string;
  licenseHash: Uint8Array;
  preset: VaultTemplatePreset | null;
  presetRevision: number;
  attestationSig: Uint8Array | null;
  attested: boolean;
  registeredBy: string;
  registeredAtLedger: bigint;
  deprecated: boolean;
}

export interface DeployedVaultRecord {
  vaultAddress: string;
  deployer: string;
  factory: string;
  templateId: string;
  templateVersion: number;
  wasmHash: Uint8Array;
  licenseUri: string;
  licenseHash: Uint8Array;
  attested: boolean;
  deployedAtLedger: bigint;
}

export interface FactoryProvenance {
  factory: string;
  templateId: string;
  templateVersion: number;
  wasmHash: Uint8Array;
  licenseUri: string;
  licenseHash: Uint8Array;
  attested: boolean;
  deployedAtLedger: bigint;
}

export interface AttestationPayloadInput {
  templateId: string;
  version: number;
  wasmHash: Uint8Array;
  paramsSchema: string;
  licenseUri: string;
  licenseHash: Uint8Array;
}

export interface RegisterFactoryTemplateParams extends AttestationPayloadInput {
  caller: string;
  preset?: VaultTemplatePreset | null;
  attestationSig?: Uint8Array | null;
}

export interface DeployVaultParams {
  deployer: string;
  templateId: string;
  version: number;
  salt: Uint8Array;
  vaultAdmin: string;
  signers: string[];
  baseSpendingLimit: bigint;
  presetOverride?: VaultTemplatePreset | null;
}

export interface VerifyRegistryMetadataOptions {
  /** Expected maintainer Ed25519 public key (raw 32 bytes or G... StrKey). */
  maintainerPubkey?: Uint8Array | string;
  /** When true, unattested templates fail verification. */
  requireAttestation?: boolean;
  /** Optional expected 32-byte WASM hash to pin against. */
  expectedWasmHash?: Uint8Array;
  /** Optional canonical license text whose SHA-256 must match `record.licenseHash`. */
  expectedLicenseText?: string;
  /** Optional expected 32-byte license hash to pin against. */
  expectedLicenseHash?: Uint8Array;
}

export interface RegistryVerificationResult {
  valid: boolean;
  errors: string[];
  attested: boolean;
  signatureValid: boolean | null;
  licenseHashValid: boolean | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isAllZero(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function validateBytesLen(
  field: string,
  value: Uint8Array,
  expectedLen: number
): void {
  if (!(value instanceof Uint8Array) || value.length !== expectedLen) {
    throw new SdkValidationError(
      field,
      value,
      `${field} must be a Uint8Array of exactly ${expectedLen} bytes`
    );
  }
}

function resolveKeypairForVerify(key: Uint8Array | string): Keypair {
  if (typeof key === "string") {
    return Keypair.fromPublicKey(key);
  }
  validateBytesLen("maintainerPubkey", key, 32);
  const strKey = StrKey.encodeEd25519PublicKey(key as any);
  return Keypair.fromPublicKey(strKey);
}

function stringToScVal(value: string): xdr.ScVal {
  return xdr.ScVal.scvString(value);
}

function bytesToScVal(value: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(value as any);
}

function presetToScVal(preset: VaultTemplatePreset): xdr.ScVal {
  return structToScVal({
    admin_rotation_delay: u64ToScVal(preset.adminRotationDelay),
    base_fee_bps: u32ToScVal(preset.baseFeeBps),
    daily_limit_ratio_percent: u32ToScVal(preset.dailyLimitRatioPercent),
    enabled_features: u32ToScVal(preset.enabledFeatures),
    fee_tiers: vecToScVal(
      preset.feeTiers.map((t) =>
        structToScVal({
          fee_bps: u32ToScVal(t.feeBps),
          volume_threshold_ratio_percent: u32ToScVal(
            t.volumeThresholdRatioPercent
          ),
        })
      )
    ),
    grace_period_ledgers: u64ToScVal(preset.gracePeriodLedgers),
    high_impact_threshold: u32ToScVal(preset.highImpactThreshold),
    quorum_percentage: u32ToScVal(preset.quorumPercentage),
    threshold_ratio_percent: u32ToScVal(preset.thresholdRatioPercent),
    timelock_delay_ledgers: u64ToScVal(preset.timelockDelayLedgers),
    timelock_threshold_pct: u32ToScVal(preset.timelockThresholdPct),
    version: u32ToScVal(preset.version),
    veto_window_ledgers: u64ToScVal(preset.vetoWindowLedgers),
    vote_weight: enumToScVal(preset.voteWeight),
    weekly_limit_ratio_percent: u32ToScVal(preset.weeklyLimitRatioPercent),
  });
}

function optionToScVal<T>(
  value: T | null | undefined,
  encoder: (v: T) => xdr.ScVal
): xdr.ScVal {
  return value === null || value === undefined
    ? xdr.ScVal.scvVoid()
    : encoder(value);
}

function toUint8Array(val: unknown): Uint8Array {
  if (val instanceof Uint8Array) return new Uint8Array(val);
  if (Array.isArray(val)) return Uint8Array.from(val as number[]);
  return new Uint8Array(0);
}

function mapTemplateRecord(raw: any): TemplateVersionRecord {
  return {
    templateId: String(raw.template_id ?? raw.templateId ?? ""),
    version: Number(raw.version ?? 0),
    wasmHash: toUint8Array(raw.wasm_hash ?? raw.wasmHash),
    paramsSchema: String(raw.params_schema ?? raw.paramsSchema ?? ""),
    licenseUri: String(raw.license_uri ?? raw.licenseUri ?? ""),
    licenseHash: toUint8Array(raw.license_hash ?? raw.licenseHash),
    preset: raw.preset ?? null,
    presetRevision: Number(raw.preset_revision ?? raw.presetRevision ?? 0),
    attestationSig:
      raw.attestation_sig || raw.attestationSig
        ? toUint8Array(raw.attestation_sig ?? raw.attestationSig)
        : null,
    attested: Boolean(raw.attested),
    registeredBy: String(raw.registered_by ?? raw.registeredBy ?? ""),
    registeredAtLedger: BigInt(
      raw.registered_at_ledger ?? raw.registeredAtLedger ?? 0
    ),
    deprecated: Boolean(raw.deprecated),
  };
}

function mapDeployedRecord(raw: any): DeployedVaultRecord {
  return {
    vaultAddress: String(raw.vault_address ?? raw.vaultAddress ?? ""),
    deployer: String(raw.deployer ?? ""),
    factory: String(raw.factory ?? ""),
    templateId: String(raw.template_id ?? raw.templateId ?? ""),
    templateVersion: Number(raw.template_version ?? raw.templateVersion ?? 0),
    wasmHash: toUint8Array(raw.wasm_hash ?? raw.wasmHash),
    licenseUri: String(raw.license_uri ?? raw.licenseUri ?? ""),
    licenseHash: toUint8Array(raw.license_hash ?? raw.licenseHash),
    attested: Boolean(raw.attested),
    deployedAtLedger: BigInt(raw.deployed_at_ledger ?? raw.deployedAtLedger ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Off-chain Attestation & Registry Verification Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 digest of a canonical license text.
 */
export function computeLicenseHash(
  licenseText: string | Uint8Array
): Uint8Array {
  const bytes =
    typeof licenseText === "string"
      ? UTF8_ENCODER.encode(licenseText)
      : licenseText;
  return new Uint8Array(stellarSha256(bytes as any));
}

/**
 * Build the canonical attestation payload signed by the maintainer's Ed25519
 * key. Byte-for-byte identical to `factory::build_attestation_message` on-chain.
 */
export function buildTemplateAttestationMessage(
  input: AttestationPayloadInput
): Uint8Array {
  validateNonEmptyString("templateId", input.templateId);
  validatePositiveNumber("version", input.version);
  validateBytesLen("wasmHash", input.wasmHash, 32);
  validateNonEmptyString("paramsSchema", input.paramsSchema);
  validateNonEmptyString("licenseUri", input.licenseUri);
  validateBytesLen("licenseHash", input.licenseHash, 32);

  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, input.version, false);

  return concatBytes([
    UTF8_ENCODER.encode(ATTESTATION_DOMAIN),
    new Uint8Array(xdr.ScVal.scvString(input.templateId).toXDR()),
    versionBytes,
    input.wasmHash,
    new Uint8Array(xdr.ScVal.scvString(input.paramsSchema).toXDR()),
    new Uint8Array(xdr.ScVal.scvString(input.licenseUri).toXDR()),
    input.licenseHash,
  ]);
}

/**
 * Sign a template version's canonical attestation payload with a Stellar
 * maintainer `Keypair` (Ed25519). Returns the 64-byte signature.
 */
export function signTemplateAttestation(
  input: AttestationPayloadInput,
  maintainerKeypair: Keypair
): Uint8Array {
  const message = buildTemplateAttestationMessage(input);
  return new Uint8Array(maintainerKeypair.sign(message as any));
}

/**
 * Cryptographically verify a `TemplateVersionRecord`'s Ed25519 maintainer
 * attestation signature against `maintainerPubkey`.
 */
export function verifyTemplateAttestation(
  record: Pick<
    TemplateVersionRecord,
    | "templateId"
    | "version"
    | "wasmHash"
    | "paramsSchema"
    | "licenseUri"
    | "licenseHash"
    | "attestationSig"
  >,
  maintainerPubkey: Uint8Array | string
): boolean {
  if (!record.attestationSig || record.attestationSig.length !== 64) {
    return false;
  }
  try {
    const kp = resolveKeypairForVerify(maintainerPubkey);
    const message = buildTemplateAttestationMessage(record);
    return kp.verify(message as any, record.attestationSig as any);
  } catch {
    return false;
  }
}

/**
 * Verify a registry `TemplateVersionRecord` before deploying a vault from it.
 *
 * Checks structural integrity, deprecation status, optional WASM/license hash
 * pinning, and optional Ed25519 maintainer attestation verification.
 */
export function verifyRegistryMetadata(
  record: TemplateVersionRecord,
  options: VerifyRegistryMetadataOptions = {}
): RegistryVerificationResult {
  const errors: string[] = [];
  let signatureValid: boolean | null = null;
  let licenseHashValid: boolean | null = null;

  if (!record.templateId || record.templateId.trim().length === 0) {
    errors.push("templateId must be non-empty");
  }
  if (!Number.isInteger(record.version) || record.version < 1) {
    errors.push("version must be a positive integer");
  }
  if (record.wasmHash.length !== 32 || isAllZero(record.wasmHash)) {
    errors.push("wasmHash must be a non-zero 32-byte digest");
  }
  if (!record.paramsSchema || record.paramsSchema.trim().length === 0) {
    errors.push("paramsSchema must be non-empty");
  }
  if (!record.licenseUri || record.licenseUri.trim().length === 0) {
    errors.push("licenseUri must be non-empty");
  }
  if (record.licenseHash.length !== 32 || isAllZero(record.licenseHash)) {
    errors.push("licenseHash must be a non-zero 32-byte digest");
  }
  if (record.deprecated) {
    errors.push("template version is deprecated");
  }

  if (options.expectedWasmHash) {
    if (!bytesEqual(record.wasmHash, options.expectedWasmHash)) {
      errors.push("wasmHash does not match expectedWasmHash");
    }
  }

  if (options.expectedLicenseText !== undefined) {
    const computed = computeLicenseHash(options.expectedLicenseText);
    licenseHashValid = bytesEqual(record.licenseHash, computed);
    if (!licenseHashValid) {
      errors.push("licenseHash does not match SHA-256 of expectedLicenseText");
    }
  } else if (options.expectedLicenseHash) {
    licenseHashValid = bytesEqual(record.licenseHash, options.expectedLicenseHash);
    if (!licenseHashValid) {
      errors.push("licenseHash does not match expectedLicenseHash");
    }
  }

  if (options.maintainerPubkey !== undefined) {
    if (record.attestationSig) {
      signatureValid = verifyTemplateAttestation(
        record,
        options.maintainerPubkey
      );
      if (!signatureValid) {
        errors.push("attestationSig failed Ed25519 verification");
      }
    } else {
      signatureValid = false;
      if (options.requireAttestation) {
        errors.push("template is missing maintainer attestation signature");
      }
    }
  } else if (options.requireAttestation && !record.attested) {
    errors.push("template is not attested and policy requires attestation");
  }

  if (options.requireAttestation && !record.attested) {
    if (
      !errors.includes("template is not attested and policy requires attestation")
    ) {
      errors.push("template is not marked attested on-chain");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    attested: record.attested && signatureValid !== false,
    signatureValid,
    licenseHashValid,
  };
}

// ---------------------------------------------------------------------------
// Factory Contract Write Bindings
// ---------------------------------------------------------------------------

/**
 * Initialize a deployed `VaultFactory` contract.
 */
export async function initFactory(
  admin: string,
  maintainerPubkey: Uint8Array,
  requireAttestation: boolean,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("admin", admin);
  validateBytesLen("maintainerPubkey", maintainerPubkey, 32);

  const contract = getContract(opts);
  const op = contract.call(
    "init_factory",
    addressToScVal(admin),
    bytesToScVal(maintainerPubkey),
    boolToScVal(requireAttestation)
  );
  return buildTransaction(admin, op, opts);
}

/**
 * Update the factory's maintainer public key and attestation enforcement policy.
 */
export async function setFactoryPolicy(
  admin: string,
  maintainerPubkey: Uint8Array,
  requireAttestation: boolean,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("admin", admin);
  validateBytesLen("maintainerPubkey", maintainerPubkey, 32);

  const contract = getContract(opts);
  const op = contract.call(
    "set_factory_policy",
    addressToScVal(admin),
    bytesToScVal(maintainerPubkey),
    boolToScVal(requireAttestation)
  );
  return buildTransaction(admin, op, opts);
}

/**
 * Register a pinned `(templateId, version)` entry in `VaultFactory`.
 */
export async function registerFactoryTemplate(
  params: RegisterFactoryTemplateParams,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("caller", params.caller);
  validateNonEmptyString("templateId", params.templateId);
  validatePositiveNumber("version", params.version);
  validateBytesLen("wasmHash", params.wasmHash, 32);
  validateNonEmptyString("paramsSchema", params.paramsSchema);
  validateNonEmptyString("licenseUri", params.licenseUri);
  validateBytesLen("licenseHash", params.licenseHash, 32);
  if (params.attestationSig) {
    validateBytesLen("attestationSig", params.attestationSig, 64);
  }

  const contract = getContract(opts);
  const op = contract.call(
    "register_factory_template",
    addressToScVal(params.caller),
    stringToScVal(params.templateId),
    u32ToScVal(params.version),
    bytesToScVal(params.wasmHash),
    stringToScVal(params.paramsSchema),
    stringToScVal(params.licenseUri),
    bytesToScVal(params.licenseHash),
    optionToScVal(params.preset, presetToScVal),
    optionToScVal(params.attestationSig, bytesToScVal)
  );
  return buildTransaction(params.caller, op, opts);
}

/**
 * Attach a maintainer Ed25519 attestation signature to an existing template version.
 */
export async function attestFactoryTemplate(
  caller: string,
  templateId: string,
  version: number,
  attestationSig: Uint8Array,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("caller", caller);
  validateNonEmptyString("templateId", templateId);
  validatePositiveNumber("version", version);
  validateBytesLen("attestationSig", attestationSig, 64);

  const contract = getContract(opts);
  const op = contract.call(
    "attest_factory_template",
    addressToScVal(caller),
    stringToScVal(templateId),
    u32ToScVal(version),
    bytesToScVal(attestationSig)
  );
  return buildTransaction(caller, op, opts);
}

/**
 * Upgrade the configuration preset for a registered template version.
 */
export async function upgradeTemplatePreset(
  admin: string,
  templateId: string,
  version: number,
  newPreset: VaultTemplatePreset,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("admin", admin);
  validateNonEmptyString("templateId", templateId);
  validatePositiveNumber("version", version);

  const contract = getContract(opts);
  const op = contract.call(
    "upgrade_template_preset",
    addressToScVal(admin),
    stringToScVal(templateId),
    u32ToScVal(version),
    presetToScVal(newPreset)
  );
  return buildTransaction(admin, op, opts);
}

/**
 * Deprecate a template version so new vaults cannot deploy from it.
 */
export async function deprecateFactoryTemplate(
  admin: string,
  templateId: string,
  version: number,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("admin", admin);
  validateNonEmptyString("templateId", templateId);
  validatePositiveNumber("version", version);

  const contract = getContract(opts);
  const op = contract.call(
    "deprecate_factory_template",
    addressToScVal(admin),
    stringToScVal(templateId),
    u32ToScVal(version)
  );
  return buildTransaction(admin, op, opts);
}

/**
 * Deploy a new vault instance from a registered template WASM hash via `VaultFactory`.
 */
export async function deployVault(
  params: DeployVaultParams,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("deployer", params.deployer);
  validateNonEmptyString("templateId", params.templateId);
  validatePositiveNumber("version", params.version);
  validateBytesLen("salt", params.salt, 32);
  validateNonEmptyString("vaultAdmin", params.vaultAdmin);
  validateAddressList("signers", params.signers);
  validatePositiveBigInt("baseSpendingLimit", params.baseSpendingLimit);

  const contract = getContract(opts);
  const op = contract.call(
    "deploy_vault",
    addressToScVal(params.deployer),
    stringToScVal(params.templateId),
    u32ToScVal(params.version),
    bytesToScVal(params.salt),
    addressToScVal(params.vaultAdmin),
    vecToScVal(params.signers.map(addressToScVal)),
    i128ToScVal(params.baseSpendingLimit),
    optionToScVal(params.presetOverride, presetToScVal)
  );
  return buildTransaction(params.deployer, op, opts);
}

// ---------------------------------------------------------------------------
// Factory & Vault Read-Only Bindings
// ---------------------------------------------------------------------------

/** Fetch the active `FactoryPolicy` from a `VaultFactory` contract. */
export async function getFactoryPolicy(
  sourceKey: string,
  opts: SdkOptions
): Promise<FactoryPolicy> {
  const contract = getContract(opts);
  const op = contract.call("get_factory_policy");
  const raw = await simulateReadOnly<any>(
    op,
    opts,
    sourceKey,
    "get_factory_policy"
  );
  return {
    admin: String(raw.admin ?? ""),
    maintainerPubkey: toUint8Array(raw.maintainer_pubkey ?? raw.maintainerPubkey),
    requireAttestation: Boolean(
      raw.require_attestation ?? raw.requireAttestation
    ),
  };
}

/** Fetch a registered `(templateId, version)` record from `VaultFactory`. */
export async function getFactoryTemplate(
  templateId: string,
  version: number,
  sourceKey: string,
  opts: SdkOptions
): Promise<TemplateVersionRecord> {
  validateNonEmptyString("templateId", templateId);
  validatePositiveNumber("version", version);
  const contract = getContract(opts);
  const op = contract.call(
    "get_factory_template",
    stringToScVal(templateId),
    u32ToScVal(version)
  );
  const raw = await simulateReadOnly<any>(
    op,
    opts,
    sourceKey,
    "get_factory_template"
  );
  return mapTemplateRecord(raw);
}

/** Fetch the highest registered version number for a template ID. */
export async function getLatestTemplateVersion(
  templateId: string,
  sourceKey: string,
  opts: SdkOptions
): Promise<number> {
  validateNonEmptyString("templateId", templateId);
  const contract = getContract(opts);
  const op = contract.call(
    "get_latest_template_version",
    stringToScVal(templateId)
  );
  const raw = await simulateReadOnly<number>(
    op,
    opts,
    sourceKey,
    "get_latest_template_version"
  );
  return Number(raw);
}

/** List all registered template version records from `VaultFactory`. */
export async function listFactoryTemplates(
  sourceKey: string,
  opts: SdkOptions
): Promise<TemplateVersionRecord[]> {
  const contract = getContract(opts);
  const op = contract.call("list_factory_templates");
  const raw = await simulateReadOnly<any[]>(
    op,
    opts,
    sourceKey,
    "list_factory_templates"
  );
  return (raw ?? []).map(mapTemplateRecord);
}

/** Fetch the factory deployment record for a specific vault address. */
export async function getDeployedVault(
  vaultAddress: string,
  sourceKey: string,
  opts: SdkOptions
): Promise<DeployedVaultRecord> {
  validateNonEmptyString("vaultAddress", vaultAddress);
  const contract = getContract(opts);
  const op = contract.call("get_deployed_vault", addressToScVal(vaultAddress));
  const raw = await simulateReadOnly<any>(
    op,
    opts,
    sourceKey,
    "get_deployed_vault"
  );
  return mapDeployedRecord(raw);
}

/** List all vaults deployed through `VaultFactory`. */
export async function listDeployedVaults(
  sourceKey: string,
  opts: SdkOptions
): Promise<DeployedVaultRecord[]> {
  const contract = getContract(opts);
  const op = contract.call("list_deployed_vaults");
  const raw = await simulateReadOnly<any[]>(
    op,
    opts,
    sourceKey,
    "list_deployed_vaults"
  );
  return (raw ?? []).map(mapDeployedRecord);
}

/**
 * Fetch the on-chain `FactoryProvenance` recorded on a deployed `VaultDAO`
 * instance (`opts.contractId` should be the deployed vault's contract ID).
 */
export async function getFactoryProvenance(
  sourceKey: string,
  opts: SdkOptions
): Promise<FactoryProvenance | null> {
  const contract = getContract(opts);
  const op = contract.call("get_factory_provenance");
  const raw = await simulateReadOnly<any>(
    op,
    opts,
    sourceKey,
    "get_factory_provenance"
  );
  if (!raw) return null;
  return {
    factory: String(raw.factory ?? ""),
    templateId: String(raw.template_id ?? raw.templateId ?? ""),
    templateVersion: Number(raw.template_version ?? raw.templateVersion ?? 0),
    wasmHash: toUint8Array(raw.wasm_hash ?? raw.wasmHash),
    licenseUri: String(raw.license_uri ?? raw.licenseUri ?? ""),
    licenseHash: toUint8Array(raw.license_hash ?? raw.licenseHash),
    attested: Boolean(raw.attested),
    deployedAtLedger: BigInt(raw.deployed_at_ledger ?? raw.deployedAtLedger ?? 0),
  };
}
