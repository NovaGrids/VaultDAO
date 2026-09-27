/**
 * Lint test — Issue #1797: contract function name allowlist.
 *
 * Scans every string literal passed to `readContractValue(...)` and
 * `functionName: '...'` / `functionName: "..."` in useVaultContract.ts and
 * asserts that each name exists in the canonical set of public functions
 * exported by the VaultDAO Soroban contract.
 *
 * The canonical list was generated from `contracts/vault/src/lib.rs` by
 * extracting every `pub fn` inside `impl VaultDAO`.  Add new names here when
 * a new entry-point is added to the contract.
 *
 * This test intentionally has no runtime dependencies on the contract itself —
 * it only inspects the source text of the hook, so it runs entirely in Node/jsdom
 * without any Stellar SDK mocks.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Canonical allowlist — every public function exposed by the VaultDAO contract.
// Sorted alphabetically for easy diffing.
// ---------------------------------------------------------------------------
const KNOWN_CONTRACT_FUNCTIONS = new Set<string>([
  // SEP-41 token interface functions — called against token contract addresses
  // (not VaultDAO itself) within useVaultContract.ts. Kept here so the
  // regex-based extractor doesn't flag them as unknown.
  'balance',
  // VaultDAO functions
  'abort_merge',
  'abstain_proposal',
  'add_attachment',
  'add_comment',
  'add_proposal_tag',
  'add_supported_token',
  'add_to_blacklist',
  'add_to_whitelist',
  'add_veto_address',
  'add_whitelist_entry',
  'adjust_stream_rate',
  'amend_proposal',
  'approve_config_change',
  'approve_force_rotation',
  'approve_funding_round',
  'approve_proposal',
  'approve_recovery',
  'assign_tags',
  'auto_expire_proposals',
  'auto_resolve_escrow',
  'batch_execute_proposals',
  'batch_propose_transfers',
  'bridge_to_vault',
  'bulk_add_tags',
  'bulk_add_to_blacklist',
  'bulk_add_to_whitelist',
  'bulk_remove_from_blacklist',
  'bulk_remove_from_whitelist',
  'calculate_fee',
  'cancel_funding_round',
  'cancel_proposal',
  'cancel_recovery',
  'cancel_scheduled_proposal',
  'cancel_stream',
  'cancel_subscription',
  'cancel_vesting',
  'change_priority',
  'change_vote',
  'check_permission_entry',
  'claim_stream',
  'claim_vested_tokens',
  'clear_gas_price_oracle',
  'clone_proposal',
  'close_insurance_claim_voting',
  'collect_execution_fee',
  'compare_amendments',
  'complete_merge',
  'complete_milestone',
  'compound_stake',
  'configure_emergency',
  'confirm_bridge_receipt',
  'convert_to_usd',
  'create_audit_checkpoint',
  'create_batch',
  'create_escrow',
  'create_from_template',
  'create_funding_round',
  'create_multi_phase_proposal',
  'create_prop_var_template',
  'create_scoped_delegation',
  'create_stream',
  'create_subscription',
  'create_tag',
  'create_template',
  'create_var_template',
  'create_vesting_schedule',
  'deactivate_template',
  'deactivate_var_template',
  'delegate_permission',
  'delegate_vote',
  'delegate_voting_power',
  'delete_comment',
  'delete_tag',
  'deregister_keeper_hook',
  'dispute_escrow',
  'edit_comment',
  'enable_auto_compound',
  'estimate_execution_fee',
  'estimate_proposal_cost',
  'execute_batch',
  'execute_bridge_proposal',
  'execute_config_change',
  'execute_cross_vault',
  'execute_insurance_withdrawal',
  'execute_multi_phase_proposal',
  'execute_proposal',
  'execute_recovery',
  'execute_recurring_payment',
  'execute_scheduled_proposal',
  'execute_swap_proposal',
  'execute_upgrade',
  'expire_overdue_subscriptions',
  'expire_proposal',
  'export_vault_template',
  'extend_lock',
  'extend_voting_deadline',
  'get_addresses_subscribed_to',
  'get_amendment_count',
  'get_asset_price',
  'get_attachments',
  'get_audit_checkpoint',
  'get_audit_entry',
  'get_audit_entry_count',
  'get_audit_trail',
  'get_batch',
  'get_batch_result',
  'get_blacklist_paginated',
  'get_bridge_config',
  'get_bridge_record',
  'get_cancellation_history',
  'get_cancellation_record',
  'get_capability',
  'get_cold_signature_count',
  'get_cold_signer_config',
  'get_comment',
  'get_comment_thread',
  'get_config',
  'get_cost_model',
  'get_cross_chain_proposal',
  'get_cross_vault_config',
  'get_cross_vault_proposal',
  'get_daily_spent',
  'get_delegation_chain',
  'get_delegator_scoped_delegations',
  'get_dex_config',
  'get_dispute',
  'get_escrow_info',
  'get_executable_proposals',
  'get_execution_fee_estimate',
  'get_execution_order',
  'get_fee_structure',
  'get_fees_collected',
  'get_full_quorum_threshold',
  'get_funder_escrows',
  'get_funding_round',
  'get_funding_round_config',
  'get_gas_config',
  'get_gas_price_oracle',
  'get_governance_proposal',
  'get_holiday_calendar',
  'get_insurance_claim',
  'get_insurance_claim_quorum',
  'get_insurance_config',
  'get_insurance_pool',
  'get_insurance_pool_balance',
  'get_insurance_voting_config',
  'get_keeper_hooks',
  'get_latest_snapshot',
  'get_list_mode',
  'get_max_amendments',
  'get_merge_record',
  'get_metrics',
  'get_metrics_for_period',
  'get_notification_preferences',
  'get_next_recurring_id',
  'get_participation',
  'get_participation_rate',
  'get_participation_score',
  'get_pause_cooldown_config',
  'get_pause_cooldown_remaining',
  'get_pause_state',
  'get_pending_timelocked_proposals',
  'get_permissions',
  'get_portfolio_valuation',
  'get_post_hooks',
  'get_pre_hooks',
  'get_proposal',
  'get_proposal_amendments',
  'get_proposal_comments',
  'get_proposal_disputes',
  'get_proposal_funding_rounds',
  'get_proposal_metadata',
  'get_proposal_metadata_value',
  'get_proposal_tags',
  'get_proposal_var_ref',
  'get_proposals',
  'get_proposals_by_ledger_range',
  'get_proposals_by_metadata',
  'get_proposals_by_priority',
  'get_proposals_by_status',
  'get_proposals_by_tag',
  'get_proposals_by_tag_id',
  'get_quorum',
  'get_quorum_status',
  'get_recipient_escrows',
  'get_recovery_config',
  'get_recovery_proposal',
  'get_recurring_payment',
  'get_reputation',
  'get_reputation_config',
  'get_retry_state',
  'get_role',
  'get_role_assignments',
  'get_rollback_state',
  'get_scheduled_proposals',
  'get_scheduled_proposals_in_range',
  'get_scoped_delegation',
  'get_signer_snapshot',
  'get_signer_tier',
  'get_signers',
  'get_signers_with_roles',
  'get_snapshot_at',
  'get_stake_pool_balance',
  'get_stake_record',
  'get_staking_config',
  'get_stream',
  'get_stream_auto_complete',
  'get_subscription',
  'get_subscriptions_by_subscriber',
  'get_supercession_chain',
  'get_superseded_by',
  'get_supported_tokens',
  'get_swap_result',
  'get_tag',
  'get_tag_proposals_page',
  'get_template',
  'get_template_id_by_name',
  'get_template_version',
  'get_time_weighted_config',
  'get_today_spent',
  'get_token_lock',
  'get_user_volume',
  'get_var_template',
  'get_vault_namespace',
  'get_vesting_schedule',
  'get_voting_power',
  'get_voting_strategy',
  'get_weekly_spent',
  'get_whitelist_entry',
  'get_whitelist_paginated',
  'grant_capability',
  'grant_permission',
  'has_hook_failure',
  'has_permission',
  'initialize',
  'initialize_from_template',
  'initiate_merge',
  'initiate_recovery',
  'invalidate_cache',
  'is_blacklisted',
  'is_signer',
  'is_token_supported',
  'is_whitelisted',
  'ledger_to_timestamp',
  'list_proposal_ids',
  'list_proposals',
  'list_recurring_payment_ids',
  'list_recurring_payments',
  'lock_tokens',
  'pause_recurring_payment',
  'pause_stream',
  'pause_subscription',
  'pause_vault',
  'process_dead_letter',
  'propose_bridge_transfer',
  'propose_config_change',
  'propose_cross_vault',
  'propose_force_rotation',
  'propose_insurance_withdrawal',
  'propose_scheduled_transfer',
  'propose_swap',
  'propose_transfer',
  'propose_transfer_with_deps',
  'propose_upgrade',
  'propose_vault_config_change',
  'raise_dispute',
  'reactivate_subscription',
  'register_keeper_hook',
  'register_post_hook',
  'register_pre_hook',
  'reject_proposal',
  'release_escrow',
  'release_escrow_funds',
  'release_round_funds',
  'remove_attachment',
  'remove_from_blacklist',
  'remove_from_whitelist',
  'remove_post_hook',
  'remove_pre_hook',
  'remove_proposal_metadata',
  'remove_proposal_tag',
  'remove_signer',
  'remove_supported_token',
  'remove_veto_address',
  'remove_whitelist_entry',
  'renew_subscription',
  'resolve_dispute',
  'resolve_dispute_with_outcome',
  'resolve_escrow_dispute',
  'resume_recurring_payment',
  'resume_stream',
  'resume_subscription',
  'retry_execute_proposal',
  'revoke_capability',
  'revoke_delegation',
  'revoke_permission',
  'revoke_scoped_delegation',
  'rollback_template',
  'schedule_payment',
  'schedule_payment_with_calendar',
  'set_bridge_config',
  'set_cold_signer_config',
  'set_cross_vault_config',
  'set_dex_config',
  'set_exec_window_ledgers',
  'set_fee_structure',
  'set_full_quorum_threshold',
  'set_funding_round_config',
  'set_gas_config',
  'set_gas_price_oracle',
  'set_governance_threshold',
  'set_holiday_calendar',
  'set_insurance_config',
  'set_insurance_voting_config',
  'set_list_mode',
  'set_max_amendments',
  'set_notification_preferences',
  'set_oracle_config',
  'set_pause_cooldown_config',
  'set_price',
  'set_proposal_metadata',
  'set_recovery_config',
  'set_reputation_config',
  'set_role',
  'set_signer_tier',
  'set_snapshot_interval',
  'set_stream_auto_complete',
  'set_stream_burst_factor',
  'set_template_status',
  'set_threshold_strategy',
  'set_time_weighted_config',
  'set_token_limits',
  'set_whitelist_mode',
  'stop_recurring_payment',
  'submit_cold_signature',
  'submit_insurance_claim',
  'submit_milestone',
  'supersede_proposal',
  'take_manual_snapshot',
  'timestamp_to_ledger',
  'trigger_stream_payment',
  'unlock_early',
  'unlock_tokens',
  'unpause_vault',
  'update_approval_timeout',
  'update_config_signers',
  'update_cost_model',
  'update_limits',
  'update_oracle_config',
  'update_participation_config',
  'update_quorum',
  'update_staking_config',
  'update_stream_rate_config',
  'update_template',
  'update_threshold',
  'update_var_template',
  'update_voting_strategy',
  'upgrade_subscription',
  'use_capability',
  'validate_dependencies',
  'validate_limits_pending',
  'validate_status_transition',
  'validate_template_params',
  'verify_attachment',
  'verify_audit_chain',
  'verify_audit_entry',
  'verify_audit_trail',
  'verify_audit_trail_full',
  'verify_cold_signatures',
  'verify_milestone',
  'veto_proposal',
  'vote_as_delegate',
  'vote_on_insurance_claim',
  'withdraw_fees',
  'withdraw_insurance_pool',
  'withdraw_stake_pool',
]);

// ---------------------------------------------------------------------------
// Source extraction helpers
// ---------------------------------------------------------------------------

/** Path to the hook under test, relative to this file. */
const HOOK_PATH = resolve(__dirname, '../useVaultContract.ts');

function readHookSource(): string {
  return readFileSync(HOOK_PATH, 'utf-8');
}

/**
 * Extract every function name passed as the first string argument to
 * `readContractValue(...)`.
 *
 * Matches patterns like:
 *   readContractValue('get_config', ...)
 *   readContractValue("get_role", ...)
 */
function extractReadContractValueNames(source: string): string[] {
  const names: string[] = [];
  // Match readContractValue( then optional whitespace then a quoted string
  const re = /readContractValue\(\s*['"]([a-z_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Extract every function name assigned to the `functionName` key inside an
 * `InvokeContractArgs` / `Operation.invokeHostFunction` call.
 *
 * Matches patterns like:
 *   functionName: "propose_transfer",
 *   functionName: 'approve_proposal',
 */
function extractFunctionNameLiterals(source: string): string[] {
  const names: string[] = [];
  const re = /functionName:\s*['"]([a-z_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('contract function name lint (Issue #1797)', () => {
  let source: string;
  let readContractValueNames: string[];
  let functionNameLiterals: string[];

  // Read once; all assertions share the same source snapshot.
  source = readHookSource();
  readContractValueNames = extractReadContractValueNames(source);
  functionNameLiterals = extractFunctionNameLiterals(source);

  it('extracts at least one readContractValue call (sanity check)', () => {
    expect(readContractValueNames.length).toBeGreaterThan(0);
  });

  it('extracts at least one functionName literal (sanity check)', () => {
    expect(functionNameLiterals.length).toBeGreaterThan(0);
  });

  it('every name passed to readContractValue exists in the contract ABI', () => {
    const unknown = readContractValueNames.filter(n => !KNOWN_CONTRACT_FUNCTIONS.has(n));
    expect(
      unknown,
      `readContractValue called with non-existent contract function(s): ${unknown.join(', ')}. ` +
      `Either add the function to the contract and update KNOWN_CONTRACT_FUNCTIONS, ` +
      `or remove the call from useVaultContract.ts.`,
    ).toEqual([]);
  });

  it('every functionName literal in invokeHostFunction calls exists in the contract ABI', () => {
    const unknown = functionNameLiterals.filter(n => !KNOWN_CONTRACT_FUNCTIONS.has(n));
    expect(
      unknown,
      `invokeHostFunction used with non-existent contract function(s): ${unknown.join(', ')}. ` +
      `Either add the function to the contract and update KNOWN_CONTRACT_FUNCTIONS, ` +
      `or fix the function name in useVaultContract.ts.`,
    ).toEqual([]);
  });

  it('get_vault_config is NOT referenced anywhere in useVaultContract.ts (Issue #1797)', () => {
    expect(
      source,
      'get_vault_config does not exist on the contract. Remove all references from useVaultContract.ts.',
    ).not.toContain('get_vault_config');
  });
});
