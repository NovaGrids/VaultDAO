/**
 * Tests for Issue #2230: Vault factory & template registry SDK helpers
 * (register, deploy, upgrade preset, attest, and off-chain metadata verification).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { SdkOptions } from "./types";
import {
  ATTESTATION_DOMAIN,
  computeLicenseHash,
  buildTemplateAttestationMessage,
  signTemplateAttestation,
  verifyTemplateAttestation,
  verifyRegistryMetadata,
  initFactory,
  setFactoryPolicy,
  registerFactoryTemplate,
  attestFactoryTemplate,
  upgradeTemplatePreset,
  deprecateFactoryTemplate,
  deployVault,
  getFactoryPolicy,
  getFactoryTemplate,
  getLatestTemplateVersion,
  listFactoryTemplates,
  getDeployedVault,
  listDeployedVaults,
  getFactoryProvenance,
  type TemplateVersionRecord,
  type VaultTemplatePreset,
} from "./factory";
import { SdkValidationError } from "./validation";

const mockCall = vi.fn((method: string, ...args: unknown[]) => ({
  _mockOp: true,
  method,
  args,
}));

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    getContract: vi.fn(() => ({ call: mockCall })),
    buildTransaction: vi.fn(async (sourceKey: string, op: any) => {
      return `XDR::${op.method}::${sourceKey}`;
    }),
  };
});

vi.mock("./contract", () => ({
  simulateReadOnly: vi.fn(),
}));

import { buildTransaction } from "./utils";
import { simulateReadOnly } from "./contract";

const FACTORY_OPTS: SdkOptions = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const ADMIN = Keypair.random().publicKey();
const DEPLOYER = Keypair.random().publicKey();
const SIGNER_2 = Keypair.random().publicKey();

const SAMPLE_PRESET: VaultTemplatePreset = {
  version: 1,
  thresholdRatioPercent: 67,
  quorumPercentage: 60,
  timelockDelayLedgers: BigInt(100),
  timelockThresholdPct: 50,
  vetoWindowLedgers: BigInt(200),
  dailyLimitRatioPercent: 400,
  weeklyLimitRatioPercent: 900,
  feeTiers: [{ volumeThresholdRatioPercent: 200, feeBps: 15 }],
  baseFeeBps: 25,
  enabledFeatures: 3,
  gracePeriodLedgers: BigInt(150),
  voteWeight: "Flat",
  highImpactThreshold: 70,
  adminRotationDelay: BigInt(1440),
};

function makeRecord(
  maintainerKp: Keypair,
  overrides: Partial<TemplateVersionRecord> = {}
): TemplateVersionRecord {
  const wasmHash = new Uint8Array(32).fill(0xab);
  const licenseText = "SPDX-License-Identifier: AGPL-3.0-only\n";
  const licenseHash = computeLicenseHash(licenseText);
  const base = {
    templateId: "treasury-standard",
    version: 1,
    wasmHash,
    paramsSchema: "https://schemas.vaultdao.org/treasury-v1.json",
    licenseUri: "https://spdx.org/licenses/AGPL-3.0-only.html",
    licenseHash,
  };
  const sig = signTemplateAttestation(base, maintainerKp);
  return {
    ...base,
    preset: SAMPLE_PRESET,
    presetRevision: 1,
    attestationSig: sig,
    attested: true,
    registeredBy: ADMIN,
    registeredAtLedger: BigInt(12345),
    deprecated: false,
    ...overrides,
  };
}

describe("factory.ts — Vault Factory & Template Registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Attestation cryptography & verification
  // -------------------------------------------------------------------------

  describe("attestation signing and verifyRegistryMetadata", () => {
    it("builds a deterministic canonical attestation message prefixed with ATTESTATION_DOMAIN", () => {
      const input = {
        templateId: "treasury-standard",
        version: 2,
        wasmHash: new Uint8Array(32).fill(0x11),
        paramsSchema: "https://schemas.vaultdao.org/v2.json",
        licenseUri: "https://spdx.org/licenses/MIT.html",
        licenseHash: new Uint8Array(32).fill(0x22),
      };
      const m1 = buildTemplateAttestationMessage(input);
      const m2 = buildTemplateAttestationMessage(input);
      expect(m1).toEqual(m2);
      const prefix = new TextDecoder().decode(
        m1.slice(0, ATTESTATION_DOMAIN.length)
      );
      expect(prefix).toBe(ATTESTATION_DOMAIN);
    });

    it("signs and verifies a valid maintainer Ed25519 attestation (raw bytes and StrKey)", () => {
      const maintainer = Keypair.random();
      const record = makeRecord(maintainer);

      expect(
        verifyTemplateAttestation(record, new Uint8Array(maintainer.rawPublicKey()))
      ).toBe(true);
      expect(verifyTemplateAttestation(record, maintainer.publicKey())).toBe(true);
    });

    it("rejects attestation when signed by a different key or when metadata is tampered", () => {
      const maintainer = Keypair.random();
      const attacker = Keypair.random();
      const record = makeRecord(maintainer);

      // Wrong maintainer key
      expect(verifyTemplateAttestation(record, attacker.publicKey())).toBe(false);

      // Tampered WASM hash
      const tampered = {
        ...record,
        wasmHash: new Uint8Array(32).fill(0xff),
      };
      expect(verifyTemplateAttestation(tampered, maintainer.publicKey())).toBe(
        false
      );

      // Tampered license URI
      const tamperedLicense = {
        ...record,
        licenseUri: "https://evil.example/license.txt",
      };
      expect(
        verifyTemplateAttestation(tamperedLicense, maintainer.publicKey())
      ).toBe(false);
    });

    it("verifyRegistryMetadata accepts a valid attested record with matching WASM & license text", () => {
      const maintainer = Keypair.random();
      const record = makeRecord(maintainer);
      const result = verifyRegistryMetadata(record, {
        maintainerPubkey: maintainer.publicKey(),
        requireAttestation: true,
        expectedWasmHash: record.wasmHash,
        expectedLicenseText: "SPDX-License-Identifier: AGPL-3.0-only\n",
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.attested).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.licenseHashValid).toBe(true);
    });

    it("verifyRegistryMetadata rejects unattested templates when requireAttestation is true", () => {
      const maintainer = Keypair.random();
      const unattested = makeRecord(maintainer, {
        attestationSig: null,
        attested: false,
      });

      const strict = verifyRegistryMetadata(unattested, {
        maintainerPubkey: maintainer.publicKey(),
        requireAttestation: true,
      });
      expect(strict.valid).toBe(false);
      expect(strict.attested).toBe(false);
      expect(strict.errors.length).toBeGreaterThan(0);

      // Allowed when policy does not require attestation
      const permissive = verifyRegistryMetadata(unattested, {
        maintainerPubkey: maintainer.publicKey(),
        requireAttestation: false,
      });
      expect(permissive.valid).toBe(true);
      expect(permissive.attested).toBe(false);
    });

    it("verifyRegistryMetadata rejects deprecated templates, wrong license hash, and wrong WASM hash", () => {
      const maintainer = Keypair.random();
      const record = makeRecord(maintainer, { deprecated: true });

      const result = verifyRegistryMetadata(record, {
        maintainerPubkey: maintainer.publicKey(),
        requireAttestation: true,
        expectedWasmHash: new Uint8Array(32).fill(0x99),
        expectedLicenseText: "DIFFERENT LICENSE",
      });

      expect(result.valid).toBe(false);
      expect(result.licenseHashValid).toBe(false);
      expect(result.errors).toContain("template version is deprecated");
      expect(result.errors).toContain("wasmHash does not match expectedWasmHash");
      expect(result.errors).toContain(
        "licenseHash does not match SHA-256 of expectedLicenseText"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Register / Attest / Upgrade / Deprecate / Deploy write bindings
  // -------------------------------------------------------------------------

  describe("write bindings (register, attest, upgrade, deprecate, deploy)", () => {
    it("initFactory and setFactoryPolicy encode method and arguments", async () => {
      const pk = new Uint8Array(Keypair.random().rawPublicKey());
      const xdr1 = await initFactory(ADMIN, pk, true, FACTORY_OPTS);
      expect(xdr1).toBe(`XDR::init_factory::${ADMIN}`);
      expect(mockCall).toHaveBeenCalledWith(
        "init_factory",
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      const xdr2 = await setFactoryPolicy(ADMIN, pk, false, FACTORY_OPTS);
      expect(xdr2).toBe(`XDR::set_factory_policy::${ADMIN}`);
      expect(buildTransaction).toHaveBeenCalledTimes(2);
    });

    it("registerFactoryTemplate wires all 9 arguments and validates byte lengths", async () => {
      const maintainer = Keypair.random();
      const record = makeRecord(maintainer);

      const xdr = await registerFactoryTemplate(
        {
          caller: ADMIN,
          templateId: record.templateId,
          version: record.version,
          wasmHash: record.wasmHash,
          paramsSchema: record.paramsSchema,
          licenseUri: record.licenseUri,
          licenseHash: record.licenseHash,
          preset: SAMPLE_PRESET,
          attestationSig: record.attestationSig,
        },
        FACTORY_OPTS
      );

      expect(xdr).toBe(`XDR::register_factory_template::${ADMIN}`);
      expect(mockCall).toHaveBeenCalledWith(
        "register_factory_template",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      // Invalid wasmHash length throws SdkValidationError
      await expect(
        registerFactoryTemplate(
          {
            caller: ADMIN,
            templateId: "bad",
            version: 1,
            wasmHash: new Uint8Array(16),
            paramsSchema: "schema",
            licenseUri: "https://spdx.org/licenses/MIT.html",
            licenseHash: record.licenseHash,
          },
          FACTORY_OPTS
        )
      ).rejects.toThrow(SdkValidationError);
    });

    it("attestFactoryTemplate, upgradeTemplatePreset, and deprecateFactoryTemplate wire correctly", async () => {
      const maintainer = Keypair.random();
      const record = makeRecord(maintainer);

      const attestXdr = await attestFactoryTemplate(
        ADMIN,
        record.templateId,
        1,
        record.attestationSig!,
        FACTORY_OPTS
      );
      expect(attestXdr).toBe(`XDR::attest_factory_template::${ADMIN}`);

      const upgradeXdr = await upgradeTemplatePreset(
        ADMIN,
        record.templateId,
        1,
        { ...SAMPLE_PRESET, thresholdRatioPercent: 75 },
        FACTORY_OPTS
      );
      expect(upgradeXdr).toBe(`XDR::upgrade_template_preset::${ADMIN}`);

      const deprecateXdr = await deprecateFactoryTemplate(
        ADMIN,
        record.templateId,
        1,
        FACTORY_OPTS
      );
      expect(deprecateXdr).toBe(`XDR::deprecate_factory_template::${ADMIN}`);
    });

    it("deployVault wires all 8 arguments and rejects invalid salt or spending limit", async () => {
      const salt = new Uint8Array(32).fill(5);
      const xdr = await deployVault(
        {
          deployer: DEPLOYER,
          templateId: "treasury-standard",
          version: 1,
          salt,
          vaultAdmin: DEPLOYER,
          signers: [DEPLOYER, SIGNER_2],
          baseSpendingLimit: BigInt(5_000_000),
        },
        FACTORY_OPTS
      );

      expect(xdr).toBe(`XDR::deploy_vault::${DEPLOYER}`);
      expect(mockCall).toHaveBeenCalledWith(
        "deploy_vault",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      await expect(
        deployVault(
          {
            deployer: DEPLOYER,
            templateId: "treasury-standard",
            version: 1,
            salt: new Uint8Array(8),
            vaultAdmin: DEPLOYER,
            signers: [DEPLOYER, SIGNER_2],
            baseSpendingLimit: BigInt(5_000_000),
          },
          FACTORY_OPTS
        )
      ).rejects.toThrow(SdkValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // Read-only queries
  // -------------------------------------------------------------------------

  describe("read-only registry and provenance queries", () => {
    it("decodes policy, template records, deployed vaults, and vault provenance", async () => {
      const simMock = simulateReadOnly as Mock;
      const pk = new Uint8Array(32).fill(0x42);

      simMock.mockResolvedValueOnce({
        admin: ADMIN,
        maintainer_pubkey: pk,
        require_attestation: true,
      });
      const policy = await getFactoryPolicy(DEPLOYER, FACTORY_OPTS);
      expect(policy.admin).toBe(ADMIN);
      expect(policy.requireAttestation).toBe(true);
      expect(policy.maintainerPubkey).toEqual(pk);

      simMock.mockResolvedValueOnce({
        template_id: "treasury-standard",
        version: 2,
        wasm_hash: new Uint8Array(32).fill(0xaa),
        params_schema: "https://schemas.vaultdao.org/v2.json",
        license_uri: "https://spdx.org/licenses/AGPL-3.0-only.html",
        license_hash: new Uint8Array(32).fill(0xbb),
        preset: SAMPLE_PRESET,
        preset_revision: 2,
        attestation_sig: new Uint8Array(64).fill(0xcc),
        attested: true,
        registered_by: ADMIN,
        registered_at_ledger: 500,
        deprecated: false,
      });
      const tpl = await getFactoryTemplate(
        "treasury-standard",
        2,
        DEPLOYER,
        FACTORY_OPTS
      );
      expect(tpl.templateId).toBe("treasury-standard");
      expect(tpl.version).toBe(2);
      expect(tpl.attested).toBe(true);
      expect(tpl.presetRevision).toBe(2);

      simMock.mockResolvedValueOnce(2);
      const latest = await getLatestTemplateVersion(
        "treasury-standard",
        DEPLOYER,
        FACTORY_OPTS
      );
      expect(latest).toBe(2);

      simMock.mockResolvedValueOnce([]);
      expect(await listFactoryTemplates(DEPLOYER, FACTORY_OPTS)).toEqual([]);

      const deployedAddr = FACTORY_OPTS.contractId;
      simMock.mockResolvedValueOnce({
        vault_address: deployedAddr,
        deployer: DEPLOYER,
        factory: FACTORY_OPTS.contractId,
        template_id: "treasury-standard",
        template_version: 2,
        wasm_hash: new Uint8Array(32).fill(0xaa),
        license_uri: "https://spdx.org/licenses/AGPL-3.0-only.html",
        license_hash: new Uint8Array(32).fill(0xbb),
        attested: true,
        deployed_at_ledger: 700,
      });
      const deployed = await getDeployedVault(deployedAddr, DEPLOYER, FACTORY_OPTS);
      expect(deployed.vaultAddress).toBe(deployedAddr);
      expect(deployed.templateVersion).toBe(2);

      simMock.mockResolvedValueOnce([]);
      expect(await listDeployedVaults(DEPLOYER, FACTORY_OPTS)).toEqual([]);

      simMock.mockResolvedValueOnce({
        factory: FACTORY_OPTS.contractId,
        template_id: "treasury-standard",
        template_version: 2,
        wasm_hash: new Uint8Array(32).fill(0xaa),
        license_uri: "https://spdx.org/licenses/AGPL-3.0-only.html",
        license_hash: new Uint8Array(32).fill(0xbb),
        attested: true,
        deployed_at_ledger: 700,
      });
      const prov = await getFactoryProvenance(DEPLOYER, FACTORY_OPTS);
      expect(prov?.factory).toBe(FACTORY_OPTS.contractId);
      expect(prov?.templateVersion).toBe(2);
      expect(prov?.attested).toBe(true);
    });
  });
});
