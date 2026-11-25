//! VaultDAO Factory + Template Registry (Issue #2230)
//!
//! Provides a Soroban factory contract (`VaultFactory`) that:
//! - Pins immutable `(template_id, version)` -> WASM hash entries in an on-chain registry
//! - Records `params_schema`, `license_uri`, `license_hash`, and upgradeable `VaultTemplate` presets
//! - Verifies optional Ed25519 attestation signatures from the configured maintainer key
//! - Enforces an attestation policy (`require_attestation`) before deploying any vault
//! - Deploys new vault instances from registered template WASM hashes and invokes
//!   `initialize_from_factory` so each deployed vault records provenance and emits
//!   `factory_template_version` events.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal, String, Symbol,
    Val, Vec,
};

use crate::errors::VaultError;
use crate::events;
use crate::types::{FactoryProvenance, VaultTemplate};

/// Domain separation prefix for canonical template attestation signatures.
///
/// Must stay in sync with `ATTESTATION_DOMAIN` in `@vaultdao/sdk`.
pub const ATTESTATION_DOMAIN: &[u8] = b"VAULTDAO_TEMPLATE_ATTESTATION_V1";

/// Factory governance and attestation policy.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FactoryPolicy {
    /// Factory administrator authorized to update policy, presets, and deprecations
    pub admin: Address,
    /// Ed25519 public key of the maintainer used to verify template attestations
    pub maintainer_pubkey: BytesN<32>,
    /// When `true`, `deploy_vault` rejects any template that is not attested
    pub require_attestation: bool,
}

/// Optional wrapper for `VaultTemplate` compatible with Soroban `#[contracttype]`
/// XDR serialization in test builds.
#[contracttype]
#[derive(Clone, Debug)]
pub enum OptionalVaultTemplate {
    None,
    Some(VaultTemplate),
}

impl OptionalVaultTemplate {
    pub fn is_some(&self) -> bool {
        matches!(self, Self::Some(_))
    }

    pub fn into_option(self) -> Option<VaultTemplate> {
        match self {
            Self::None => None,
            Self::Some(t) => Some(t),
        }
    }
}

/// Pinned template version entry in the factory registry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TemplateVersionRecord {
    /// Logical template identifier (e.g. `"treasury-standard"`)
    pub template_id: String,
    /// Monotonic version number (>= 1)
    pub version: u32,
    /// Pinned Soroban contract WASM hash
    pub wasm_hash: BytesN<32>,
    /// JSON Schema or schema URI describing allowed initialization parameters
    pub params_schema: String,
    /// Canonical license URI (e.g. SPDX URL or IPFS CID)
    pub license_uri: String,
    /// SHA-256 digest of the canonical license text
    pub license_hash: BytesN<32>,
    /// Optional upgradeable configuration preset applied during deployment
    pub preset: OptionalVaultTemplate,
    /// Revision counter incremented whenever `upgrade_template_preset` updates `preset`
    pub preset_revision: u32,
    /// Optional Ed25519 signature from `FactoryPolicy::maintainer_pubkey`
    pub attestation_sig: Option<BytesN<64>>,
    /// `true` iff a valid maintainer signature was verified on-chain
    pub attested: bool,
    /// Address that registered this template version
    pub registered_by: Address,
    /// Ledger sequence at registration time
    pub registered_at_ledger: u64,
    /// When `true`, new deployments from this version are blocked
    pub deprecated: bool,
}

/// Record of a vault instance deployed through `VaultFactory`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeployedVaultRecord {
    pub vault_address: Address,
    pub deployer: Address,
    pub factory: Address,
    pub template_id: String,
    pub template_version: u32,
    pub wasm_hash: BytesN<32>,
    pub license_uri: String,
    pub license_hash: BytesN<32>,
    pub attested: bool,
    pub deployed_at_ledger: u64,
}

#[contracttype(export = false)]
#[derive(Clone)]
enum FactoryKey {
    Policy,
    Template(String, u32),
    LatestVersion(String),
    TemplateIndex,
    DeployedVault(Address),
    DeployedIndex,
}

/// Build the canonical byte payload signed by the maintainer's Ed25519 key to
/// attest a template version.
pub fn build_attestation_message(
    env: &Env,
    template_id: &String,
    version: u32,
    wasm_hash: &BytesN<32>,
    params_schema: &String,
    license_uri: &String,
    license_hash: &BytesN<32>,
) -> Bytes {
    let mut msg = Bytes::from_slice(env, ATTESTATION_DOMAIN);
    msg.append(&template_id.clone().to_xdr(env));
    msg.extend_from_array(&version.to_be_bytes());
    msg.extend_from_array(&wasm_hash.to_array());
    msg.append(&params_schema.clone().to_xdr(env));
    msg.append(&license_uri.clone().to_xdr(env));
    msg.extend_from_array(&license_hash.to_array());
    msg
}

fn is_zero_hash(hash: &BytesN<32>) -> bool {
    hash.to_array() == [0u8; 32]
}

fn validate_preset(preset: &VaultTemplate) -> Result<(), VaultError> {
    if preset.threshold_ratio_percent == 0 || preset.threshold_ratio_percent > 100 {
        return Err(VaultError::InvalidTemplate);
    }
    if preset.quorum_percentage > 100 || preset.high_impact_threshold > 100 {
        return Err(VaultError::InvalidTemplate);
    }
    Ok(())
}

fn read_policy(env: &Env) -> Result<FactoryPolicy, VaultError> {
    env.storage()
        .instance()
        .get(&FactoryKey::Policy)
        .ok_or(VaultError::FactoryNotInitialized)
}

#[contract]
pub struct VaultFactory;

#[contractimpl]
impl VaultFactory {
    /// Initialize the factory contract with its admin, maintainer public key,
    /// and attestation enforcement policy.
    pub fn init_factory(
        env: Env,
        admin: Address,
        maintainer_pubkey: BytesN<32>,
        require_attestation: bool,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        if env.storage().instance().has(&FactoryKey::Policy) {
            return Err(VaultError::AlreadyInitialized);
        }
        if is_zero_hash(&maintainer_pubkey) {
            return Err(VaultError::InvalidFactoryTemplate);
        }

        let policy = FactoryPolicy {
            admin: admin.clone(),
            maintainer_pubkey,
            require_attestation,
        };
        env.storage().instance().set(&FactoryKey::Policy, &policy);
        events::emit_factory_initialized(&env, &admin, require_attestation);
        Ok(())
    }

    /// Update the factory's maintainer public key and/or attestation policy.
    pub fn set_factory_policy(
        env: Env,
        admin: Address,
        maintainer_pubkey: BytesN<32>,
        require_attestation: bool,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let mut policy = read_policy(&env)?;
        if policy.admin != admin {
            return Err(VaultError::Unauthorized);
        }
        if is_zero_hash(&maintainer_pubkey) {
            return Err(VaultError::InvalidFactoryTemplate);
        }

        policy.maintainer_pubkey = maintainer_pubkey;
        policy.require_attestation = require_attestation;
        env.storage().instance().set(&FactoryKey::Policy, &policy);
        events::emit_factory_policy_updated(&env, &admin, require_attestation);
        Ok(())
    }

    /// Return the active factory policy.
    pub fn get_factory_policy(env: Env) -> Result<FactoryPolicy, VaultError> {
        read_policy(&env)
    }

    /// Register a new pinned `(template_id, version)` entry in the registry.
    ///
    /// If `attestation_sig` is supplied, the factory verifies it against
    /// `FactoryPolicy::maintainer_pubkey` using `ed25519_verify` (trapping if
    /// invalid) and marks `attested = true`. If omitted, the template is stored
    /// with `attested = false` and can be attested later via
    /// [`Self::attest_factory_template`], or deployed directly when
    /// `require_attestation == false`.
    #[allow(clippy::too_many_arguments)]
    pub fn register_factory_template(
        env: Env,
        caller: Address,
        template_id: String,
        version: u32,
        wasm_hash: BytesN<32>,
        params_schema: String,
        license_uri: String,
        license_hash: BytesN<32>,
        preset: Option<VaultTemplate>,
        attestation_sig: Option<BytesN<64>>,
    ) -> Result<TemplateVersionRecord, VaultError> {
        caller.require_auth();
        let policy = read_policy(&env)?;

        if template_id.is_empty()
            || version == 0
            || params_schema.is_empty()
            || license_uri.is_empty()
            || is_zero_hash(&wasm_hash)
            || is_zero_hash(&license_hash)
        {
            return Err(VaultError::InvalidFactoryTemplate);
        }

        let key = FactoryKey::Template(template_id.clone(), version);
        if env.storage().persistent().has(&key) {
            return Err(VaultError::TemplateAlreadyExists);
        }

        if let Some(ref tpl) = preset {
            validate_preset(tpl)?;
        }

        let attested = if let Some(ref sig) = attestation_sig {
            let msg = build_attestation_message(
                &env,
                &template_id,
                version,
                &wasm_hash,
                &params_schema,
                &license_uri,
                &license_hash,
            );
            // Traps if the Ed25519 signature is invalid.
            env.crypto()
                .ed25519_verify(&policy.maintainer_pubkey, &msg, sig);
            true
        } else {
            false
        };

        let stored_preset = match preset {
            Some(t) => OptionalVaultTemplate::Some(t),
            None => OptionalVaultTemplate::None,
        };
        let record = TemplateVersionRecord {
            template_id: template_id.clone(),
            version,
            wasm_hash: wasm_hash.clone(),
            params_schema,
            license_uri: license_uri.clone(),
            license_hash: license_hash.clone(),
            preset_revision: if stored_preset.is_some() { 1 } else { 0 },
            preset: stored_preset,
            attestation_sig,
            attested,
            registered_by: caller,
            registered_at_ledger: env.ledger().sequence() as u64,
            deprecated: false,
        };

        env.storage().persistent().set(&key, &record);

        let latest_key = FactoryKey::LatestVersion(template_id.clone());
        let current_latest: u32 = env.storage().persistent().get(&latest_key).unwrap_or(0);
        if version > current_latest {
            env.storage().persistent().set(&latest_key, &version);
        }

        let mut index: Vec<(String, u32)> = env
            .storage()
            .instance()
            .get(&FactoryKey::TemplateIndex)
            .unwrap_or_else(|| Vec::new(&env));
        index.push_back((template_id.clone(), version));
        env.storage()
            .instance()
            .set(&FactoryKey::TemplateIndex, &index);

        events::emit_factory_template_registered(
            &env,
            &template_id,
            version,
            &wasm_hash,
            &license_uri,
            &license_hash,
            attested,
        );

        Ok(record)
    }

    /// Attach and verify a maintainer Ed25519 attestation signature for an
    /// already-registered template version.
    pub fn attest_factory_template(
        env: Env,
        caller: Address,
        template_id: String,
        version: u32,
        attestation_sig: BytesN<64>,
    ) -> Result<TemplateVersionRecord, VaultError> {
        caller.require_auth();
        let policy = read_policy(&env)?;

        let key = FactoryKey::Template(template_id.clone(), version);
        let mut record: TemplateVersionRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VaultError::TemplateNotFound)?;

        let msg = build_attestation_message(
            &env,
            &record.template_id,
            record.version,
            &record.wasm_hash,
            &record.params_schema,
            &record.license_uri,
            &record.license_hash,
        );
        env.crypto()
            .ed25519_verify(&policy.maintainer_pubkey, &msg, &attestation_sig);

        record.attestation_sig = Some(attestation_sig);
        record.attested = true;
        env.storage().persistent().set(&key, &record);

        events::emit_factory_template_attested(&env, &template_id, version);
        Ok(record)
    }

    /// Upgrade the configuration preset associated with a registered template
    /// version without altering its pinned WASM hash or license metadata.
    pub fn upgrade_template_preset(
        env: Env,
        admin: Address,
        template_id: String,
        version: u32,
        new_preset: VaultTemplate,
    ) -> Result<TemplateVersionRecord, VaultError> {
        admin.require_auth();
        let policy = read_policy(&env)?;
        if policy.admin != admin {
            return Err(VaultError::Unauthorized);
        }
        validate_preset(&new_preset)?;

        let key = FactoryKey::Template(template_id.clone(), version);
        let mut record: TemplateVersionRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VaultError::TemplateNotFound)?;

        record.preset = OptionalVaultTemplate::Some(new_preset);
        record.preset_revision = record.preset_revision.saturating_add(1);
        env.storage().persistent().set(&key, &record);

        events::emit_factory_template_preset_upgraded(
            &env,
            &template_id,
            version,
            record.preset_revision,
        );
        Ok(record)
    }

    /// Deprecate a registered template version so no new vaults may deploy it.
    pub fn deprecate_factory_template(
        env: Env,
        admin: Address,
        template_id: String,
        version: u32,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let policy = read_policy(&env)?;
        if policy.admin != admin {
            return Err(VaultError::Unauthorized);
        }

        let key = FactoryKey::Template(template_id.clone(), version);
        let mut record: TemplateVersionRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VaultError::TemplateNotFound)?;

        record.deprecated = true;
        env.storage().persistent().set(&key, &record);
        events::emit_factory_template_deprecated(&env, &template_id, version);
        Ok(())
    }

    /// Deploy a new vault contract instance from a registered template WASM
    /// hash, initialize it with factory provenance, and emit deployment events.
    ///
    /// Rejects unknown templates (`TemplateNotFound`), deprecated templates
    /// (`TemplateInactive`), and unattested templates when
    /// `FactoryPolicy::require_attestation` is `true` (`TemplateNotAttested`).
    #[allow(clippy::too_many_arguments)]
    pub fn deploy_vault(
        env: Env,
        deployer: Address,
        template_id: String,
        version: u32,
        salt: BytesN<32>,
        vault_admin: Address,
        signers: Vec<Address>,
        base_spending_limit: i128,
        preset_override: Option<VaultTemplate>,
    ) -> Result<Address, VaultError> {
        deployer.require_auth();
        let policy = read_policy(&env)?;

        let key = FactoryKey::Template(template_id.clone(), version);
        let record: TemplateVersionRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VaultError::TemplateNotFound)?;

        if record.deprecated {
            return Err(VaultError::TemplateInactive);
        }
        if policy.require_attestation && !record.attested {
            return Err(VaultError::TemplateNotAttested);
        }
        if base_spending_limit <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let preset = match preset_override {
            Some(p) => {
                validate_preset(&p)?;
                p
            }
            None => record
                .preset
                .clone()
                .into_option()
                .ok_or(VaultError::InvalidTemplate)?,
        };

        let factory_addr = env.current_contract_address();
        let vault_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(record.wasm_hash.clone(), ());

        let provenance = FactoryProvenance {
            factory: factory_addr.clone(),
            template_id: record.template_id.clone(),
            template_version: record.version,
            wasm_hash: record.wasm_hash.clone(),
            license_uri: record.license_uri.clone(),
            license_hash: record.license_hash.clone(),
            attested: record.attested,
            deployed_at_ledger: env.ledger().sequence() as u64,
        };
        let init_args: Vec<Val> = (
            provenance,
            vault_admin,
            signers,
            preset,
            base_spending_limit,
        )
            .into_val(&env);
        env.invoke_contract::<()>(
            &vault_address,
            &Symbol::new(&env, "initialize_from_factory"),
            init_args,
        );

        let deployed = DeployedVaultRecord {
            vault_address: vault_address.clone(),
            deployer: deployer.clone(),
            factory: factory_addr,
            template_id: record.template_id.clone(),
            template_version: record.version,
            wasm_hash: record.wasm_hash.clone(),
            license_uri: record.license_uri,
            license_hash: record.license_hash,
            attested: record.attested,
            deployed_at_ledger: env.ledger().sequence() as u64,
        };
        env.storage()
            .persistent()
            .set(&FactoryKey::DeployedVault(vault_address.clone()), &deployed);

        let mut deployed_index: Vec<Address> = env
            .storage()
            .instance()
            .get(&FactoryKey::DeployedIndex)
            .unwrap_or_else(|| Vec::new(&env));
        deployed_index.push_back(vault_address.clone());
        env.storage()
            .instance()
            .set(&FactoryKey::DeployedIndex, &deployed_index);

        events::emit_factory_vault_deployed(
            &env,
            &vault_address,
            &record.template_id,
            record.version,
            &record.wasm_hash,
            &deployer,
            record.attested,
        );

        Ok(vault_address)
    }

    /// Look up a specific `(template_id, version)` record in the registry.
    pub fn get_factory_template(
        env: Env,
        template_id: String,
        version: u32,
    ) -> Result<TemplateVersionRecord, VaultError> {
        env.storage()
            .persistent()
            .get(&FactoryKey::Template(template_id, version))
            .ok_or(VaultError::TemplateNotFound)
    }

    /// Return the highest registered version number for `template_id`.
    pub fn get_latest_template_version(env: Env, template_id: String) -> Result<u32, VaultError> {
        env.storage()
            .persistent()
            .get(&FactoryKey::LatestVersion(template_id))
            .ok_or(VaultError::TemplateNotFound)
    }

    /// List all registered template version records.
    pub fn list_factory_templates(env: Env) -> Vec<TemplateVersionRecord> {
        let index: Vec<(String, u32)> = env
            .storage()
            .instance()
            .get(&FactoryKey::TemplateIndex)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for (template_id, version) in index.iter() {
            if let Some(rec) = env
                .storage()
                .persistent()
                .get(&FactoryKey::Template(template_id, version))
            {
                out.push_back(rec);
            }
        }
        out
    }

    /// Look up deployment provenance for a vault address deployed by this factory.
    pub fn get_deployed_vault(
        env: Env,
        vault_address: Address,
    ) -> Result<DeployedVaultRecord, VaultError> {
        env.storage()
            .persistent()
            .get(&FactoryKey::DeployedVault(vault_address))
            .ok_or(VaultError::DeployedVaultNotFound)
    }

    /// List all vaults deployed through this factory.
    pub fn list_deployed_vaults(env: Env) -> Vec<DeployedVaultRecord> {
        let index: Vec<Address> = env
            .storage()
            .instance()
            .get(&FactoryKey::DeployedIndex)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for addr in index.iter() {
            if let Some(rec) = env
                .storage()
                .persistent()
                .get(&FactoryKey::DeployedVault(addr))
            {
                out.push_back(rec);
            }
        }
        out
    }

    /// Compute the canonical attestation message bytes for off-chain signing
    /// and SDK verification parity.
    pub fn factory_attestation_message(
        env: Env,
        template_id: String,
        version: u32,
        wasm_hash: BytesN<32>,
        params_schema: String,
        license_uri: String,
        license_hash: BytesN<32>,
    ) -> Bytes {
        build_attestation_message(
            &env,
            &template_id,
            version,
            &wasm_hash,
            &params_schema,
            &license_uri,
            &license_hash,
        )
    }
}
