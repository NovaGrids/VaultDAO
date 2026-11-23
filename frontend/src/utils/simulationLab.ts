/**
 * Frontend Simulation Lab — SDK Simulate Helpers & Limit/Breaker Preview Engine
 * (Issue #2228)
 *
 * Dry-runs governance transactions (`create`, `vote`, `execute`, `swap`)
 * against threshold, spending limits, circuit-breaker headroom, oracle
 * freshness, pause state, and Soroban resource budgets before signing.
 */

export type SimulationActionType = 'create' | 'vote' | 'execute' | 'swap';

export type VoteChoice = 'approve' | 'reject' | 'abstain';

export interface CreateTxParams {
  action: 'create';
  recipient: string;
  token: string;
  amountStroops: bigint;
  memo: string;
}

export interface VoteTxParams {
  action: 'vote';
  proposalId: string;
  choice: VoteChoice;
}

export interface ExecuteTxParams {
  action: 'execute';
  proposalId: string;
  amountStroops: bigint;
}

export interface SwapTxParams {
  action: 'swap';
  dex: string;
  tokenIn: string;
  tokenOut: string;
  amountInStroops: bigint;
  minAmountOutStroops: bigint;
}

export type SimulationTxParams =
  | CreateTxParams
  | VoteTxParams
  | ExecuteTxParams
  | SwapTxParams;

/**
 * Snapshot of on-chain contract getter values used for limit, breaker, pause,
 * and oracle previews. Field formulas match `contracts/vault/src/storage.rs`
 * and `TreasuryRiskSnapshot` (Issue #2061).
 */
export interface ContractStateFixture {
  vaultId: string;
  currentLedger: number;
  threshold: number;
  signerCount: number;
  spendingLimitStroops: bigint;
  dailyLimitStroops: bigint;
  weeklyLimitStroops: bigint;
  dailySpentStroops: bigint;
  weeklySpentStroops: bigint;
  /** Treasury risk getters (Issue #2061) */
  balanceStroops: bigint;
  earmarkedStroops: bigint;
  pendingReservationsStroops: bigint;
  lockedStroops: bigint;
  /** Circuit breaker getters */
  breakerThresholdStroops: bigint;
  breakerWindowOutflowStroops: bigint;
  breakerTripped: boolean;
  /** Pause getter (`get_pause_state`) */
  pauseState: {
    isPaused: boolean;
    pausedBy: string | null;
    pausedAtLedger: number;
    cause: string;
  };
  /** Oracle freshness getter */
  oracleState: {
    lastUpdatedLedger: number;
    maxAgeLedgers: number;
    priceFeedSymbol: string;
  };
}

export interface SorobanResourcePreview {
  estimatedFeeStroops: bigint;
  resourceFeeStroops: bigint;
  baseFeeStroops: bigint;
  cpuInstructions: number;
  memoryBytes: number;
  readBytes: number;
  writeBytes: number;
  ledgerReads: number;
  ledgerWrites: number;
}

export interface LimitMetricPreview {
  limitStroops: bigint;
  usedBeforeStroops: bigint;
  usedAfterStroops: bigint;
  remainingAfterStroops: bigint;
  utilizationPercent: number;
  exceeds: boolean;
}

export interface LimitAndBreakerPreview {
  txAmountStroops: bigint;
  perProposal: {
    limitStroops: bigint;
    exceeds: boolean;
  };
  daily: LimitMetricPreview;
  weekly: LimitMetricPreview;
  /** `max(0, balance - earmarked - pending - locked)` */
  spendableStroops: bigint;
  insufficientSpendable: boolean;
  breakerThresholdStroops: bigint;
  breakerOutflowBeforeStroops: bigint;
  breakerOutflowAfterStroops: bigint;
  breakerHeadroomBeforeStroops: bigint;
  breakerHeadroomAfterStroops: bigint;
  breakerHeadroomPercentAfter: number;
  willTripBreaker: boolean;
}

export type WarningSeverity = 'warning' | 'critical';

export interface SimulationWarning {
  code:
    | 'VAULT_PAUSED'
    | 'STALE_ORACLE'
    | 'BREAKER_TRIPPED'
    | 'BREAKER_LOW_HEADROOM'
    | 'LIMIT_EXCEEDED'
    | 'INSUFFICIENT_SPENDABLE';
  severity: WarningSeverity;
  title: string;
  detail: string;
}

export interface TypedSdkErrorInfo {
  code: number;
  name: string;
  description: string;
  remediation: string;
  rawMessage: string;
}

export class SimulationSdkError extends Error {
  public readonly info: TypedSdkErrorInfo;

  constructor(info: TypedSdkErrorInfo) {
    super(`VaultError(${info.code}) ${info.name}: ${info.description}`);
    this.name = 'SimulationSdkError';
    this.info = info;
  }
}

export interface SimulationLabOutcome {
  ok: boolean;
  action: SimulationActionType;
  timestampIso: string;
  resources: SorobanResourcePreview | null;
  preview: LimitAndBreakerPreview;
  warnings: SimulationWarning[];
  error: TypedSdkErrorInfo | null;
  stateSummary: string[];
}

export interface SimulationLabSdkAdapter {
  simulate(
    params: SimulationTxParams,
    fixture: ContractStateFixture
  ): Promise<{
    resources: SorobanResourcePreview;
    stateSummary: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Typed SDK Error Registry (mirrors contracts/vault/src/errors.rs & @vaultdao/sdk)
// ---------------------------------------------------------------------------

const SDK_ERROR_CATALOG: Record<
  number,
  { name: string; description: string; remediation: string }
> = {
  10: {
    name: 'Unauthorized',
    description: 'Caller does not hold the required signer role for this action.',
    remediation: 'Connect an authorized Admin or Treasurer signer wallet.',
  },
  20: {
    name: 'ProposalNotFound',
    description: 'No proposal exists with the provided ID.',
    remediation: 'Verify the proposal ID on the Proposals page before retrying.',
  },
  30: {
    name: 'AlreadyApproved',
    description: 'This signer has already submitted an approval for the proposal.',
    remediation: 'Collect approvals from another signer to reach threshold.',
  },
  41: {
    name: 'ExceedsProposalLimit',
    description: 'Transfer amount exceeds the vault per-proposal spending limit.',
    remediation: 'Reduce the amount or split into phased disbursements.',
  },
  42: {
    name: 'ExceedsDailyLimit',
    description: 'Transfer amount would exceed the vault daily spending limit.',
    remediation: 'Wait for the daily window reset or lower the transfer amount.',
  },
  43: {
    name: 'ExceedsWeeklyLimit',
    description: 'Transfer amount would exceed the vault weekly spending limit.',
    remediation: 'Schedule execution after the weekly spending window resets.',
  },
  60: {
    name: 'TimelockNotExpired',
    description: 'The proposal timelock delay has not elapsed yet.',
    remediation: 'Wait until the unlock ledger is reached before executing.',
  },
  70: {
    name: 'InsufficientBalance',
    description: 'Spendable vault balance is insufficient for this transfer.',
    remediation: 'Top up the vault or release unused reservations.',
  },
  1210: {
    name: 'TwapUnavailable',
    description: 'Oracle price feed is stale or lacks fresh observations for TWAP.',
    remediation: 'Refresh oracle observations before executing a swap.',
  },
  1212: {
    name: 'SwapSlippageExceeded',
    description: 'Expected swap output violates the configured slippage guard.',
    remediation: 'Adjust minAmountOut or wait for deeper DEX liquidity.',
  },
  1224: {
    name: 'TokenCircuitBreakerTripped',
    description: 'Token outflow circuit breaker is tripped or would be exceeded.',
    remediation: 'Wait for the hourly breaker window or have an Admin reset it.',
  },
};

export function parseTypedSdkError(err: unknown): TypedSdkErrorInfo {
  if (err instanceof SimulationSdkError) {
    return err.info;
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const explicitCode =
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'number'
      ? (err as { code: number }).code
      : undefined;

  const contractMatch = rawMessage.match(/Error\(Contract,\s*#(\d+)\)/i);
  const vaultErrMatch = rawMessage.match(/VaultError\((\d+)\)/i);
  const code =
    explicitCode ??
    (contractMatch ? Number(contractMatch[1]) : undefined) ??
    (vaultErrMatch ? Number(vaultErrMatch[1]) : 0);

  const catalogEntry = SDK_ERROR_CATALOG[code];
  if (catalogEntry) {
    return {
      code,
      name: catalogEntry.name,
      description: catalogEntry.description,
      remediation: catalogEntry.remediation,
      rawMessage,
    };
  }

  return {
    code,
    name: code > 0 ? `ContractError_${code}` : 'SimulationError',
    description: rawMessage || 'Transaction simulation reverted on Soroban RPC.',
    remediation: 'Inspect transaction parameters and vault state before signing.',
    rawMessage,
  };
}

// ---------------------------------------------------------------------------
// Contract-getter-aligned Limit & Circuit-Breaker Preview Math
// ---------------------------------------------------------------------------

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function calcPercent(used: bigint, limit: bigint): number {
  if (limit <= 0n) return 0;
  const scaled = Number((used * 10000n) / limit) / 100;
  return Math.min(100, Math.max(0, Math.round(scaled * 10) / 10));
}

export function extractTxAmountStroops(params: SimulationTxParams): bigint {
  switch (params.action) {
    case 'create':
      return params.amountStroops;
    case 'execute':
      return params.amountStroops;
    case 'swap':
      return params.amountInStroops;
    case 'vote':
      return 0n;
  }
}

/**
 * Computes limit impact and circuit-breaker headroom directly from on-chain
 * contract getter values (mirrors `VaultDAO` storage invariants).
 */
export function computeLimitAndBreakerPreview(
  fixture: ContractStateFixture,
  txAmountStroops: bigint
): LimitAndBreakerPreview {
  const amount = txAmountStroops > 0n ? txAmountStroops : 0n;

  const dailyAfter = fixture.dailySpentStroops + amount;
  const dailyRemaining = maxBigInt(0n, fixture.dailyLimitStroops - dailyAfter);
  const dailyExceeds =
    fixture.dailyLimitStroops > 0n && dailyAfter > fixture.dailyLimitStroops;

  const weeklyAfter = fixture.weeklySpentStroops + amount;
  const weeklyRemaining = maxBigInt(0n, fixture.weeklyLimitStroops - weeklyAfter);
  const weeklyExceeds =
    fixture.weeklyLimitStroops > 0n && weeklyAfter > fixture.weeklyLimitStroops;

  const perProposalExceeds =
    fixture.spendingLimitStroops > 0n && amount > fixture.spendingLimitStroops;

  // Invariant from TreasuryRiskSnapshot (Issue #2061):
  // spendable = max(0, balance - earmarked - pending - locked)
  const encumbered =
    fixture.earmarkedStroops +
    fixture.pendingReservationsStroops +
    fixture.lockedStroops;
  const spendableStroops = maxBigInt(0n, fixture.balanceStroops - encumbered);
  const insufficientSpendable = amount > 0n && amount > spendableStroops;

  const breakerOutflowBefore = fixture.breakerWindowOutflowStroops;
  const breakerOutflowAfter = breakerOutflowBefore + amount;
  const breakerHeadroomBefore = maxBigInt(
    0n,
    fixture.breakerThresholdStroops - breakerOutflowBefore
  );
  const breakerHeadroomAfter = maxBigInt(
    0n,
    fixture.breakerThresholdStroops - breakerOutflowAfter
  );
  const breakerHeadroomPercentAfter =
    fixture.breakerThresholdStroops > 0n
      ? calcPercent(breakerHeadroomAfter, fixture.breakerThresholdStroops)
      : 100;

  const willTripBreaker =
    fixture.breakerTripped ||
    (fixture.breakerThresholdStroops > 0n &&
      breakerOutflowAfter > fixture.breakerThresholdStroops);

  return {
    txAmountStroops: amount,
    perProposal: {
      limitStroops: fixture.spendingLimitStroops,
      exceeds: perProposalExceeds,
    },
    daily: {
      limitStroops: fixture.dailyLimitStroops,
      usedBeforeStroops: fixture.dailySpentStroops,
      usedAfterStroops: dailyAfter,
      remainingAfterStroops: dailyRemaining,
      utilizationPercent: calcPercent(dailyAfter, fixture.dailyLimitStroops),
      exceeds: dailyExceeds,
    },
    weekly: {
      limitStroops: fixture.weeklyLimitStroops,
      usedBeforeStroops: fixture.weeklySpentStroops,
      usedAfterStroops: weeklyAfter,
      remainingAfterStroops: weeklyRemaining,
      utilizationPercent: calcPercent(weeklyAfter, fixture.weeklyLimitStroops),
      exceeds: weeklyExceeds,
    },
    spendableStroops,
    insufficientSpendable,
    breakerThresholdStroops: fixture.breakerThresholdStroops,
    breakerOutflowBeforeStroops: breakerOutflowBefore,
    breakerOutflowAfterStroops: breakerOutflowAfter,
    breakerHeadroomBeforeStroops: breakerHeadroomBefore,
    breakerHeadroomAfterStroops: breakerHeadroomAfter,
    breakerHeadroomPercentAfter,
    willTripBreaker,
  };
}

/**
 * Evaluate operational warnings (paused vault, stale oracle, breaker headroom,
 * spending limit breaches, insufficient spendable balance).
 */
export function evaluateSimulationWarnings(
  fixture: ContractStateFixture,
  action: SimulationActionType,
  preview: LimitAndBreakerPreview
): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];

  if (fixture.pauseState.isPaused) {
    warnings.push({
      code: 'VAULT_PAUSED',
      severity: 'critical',
      title: 'Vault is currently paused',
      detail: `Emergency pause active since ledger ${fixture.pauseState.pausedAtLedger} (${fixture.pauseState.cause || 'no cause specified'}). State-changing calls will revert until unpaused.`,
    });
  }

  const oracleAge =
    fixture.currentLedger - fixture.oracleState.lastUpdatedLedger;
  if (oracleAge > fixture.oracleState.maxAgeLedgers) {
    warnings.push({
      code: 'STALE_ORACLE',
      severity: action === 'swap' ? 'critical' : 'warning',
      title: 'Stale oracle price feed',
      detail: `${fixture.oracleState.priceFeedSymbol} oracle is ${oracleAge} ledgers old (max allowed: ${fixture.oracleState.maxAgeLedgers}). TWAP-guarded swaps will fail closed.`,
    });
  }

  if (preview.willTripBreaker) {
    warnings.push({
      code: 'BREAKER_TRIPPED',
      severity: 'critical',
      title: fixture.breakerTripped
        ? 'Circuit breaker is already tripped'
        : 'Transaction will trip the circuit breaker',
      detail: `Projected hourly outflow (${formatStroopsToXlm(preview.breakerOutflowAfterStroops)} XLM) exceeds breaker threshold (${formatStroopsToXlm(preview.breakerThresholdStroops)} XLM).`,
    });
  } else if (
    preview.breakerThresholdStroops > 0n &&
    preview.breakerHeadroomPercentAfter < 20
  ) {
    warnings.push({
      code: 'BREAKER_LOW_HEADROOM',
      severity: 'warning',
      title: 'Low circuit breaker headroom',
      detail: `Only ${preview.breakerHeadroomPercentAfter}% (${formatStroopsToXlm(preview.breakerHeadroomAfterStroops)} XLM) breaker headroom will remain after execution.`,
    });
  }

  if (
    preview.perProposal.exceeds ||
    preview.daily.exceeds ||
    preview.weekly.exceeds
  ) {
    warnings.push({
      code: 'LIMIT_EXCEEDED',
      severity: 'critical',
      title: 'Spending limit exceeded',
      detail:
        'Projected outflow breaches one or more configured vault spending limits (per-proposal, daily, or weekly).',
    });
  }

  if (preview.insufficientSpendable) {
    warnings.push({
      code: 'INSUFFICIENT_SPENDABLE',
      severity: 'critical',
      title: 'Insufficient spendable balance',
      detail: `Spendable balance (${formatStroopsToXlm(preview.spendableStroops)} XLM after earmarked/pending/locked reserves) is below the requested amount.`,
    });
  }

  return warnings;
}

export function formatStroopsToXlm(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = (stroops < 0n ? -stroops : stroops) % 10_000_000n;
  const fracStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}

/**
 * Default SDK-backed dry-run adapter that enforces the same contract guards
 * locally when no live RPC endpoint is attached, and surfaces typed SDK errors.
 */
export function createDefaultSimulationAdapter(): SimulationLabSdkAdapter {
  return {
    async simulate(params, fixture) {
      const amount = extractTxAmountStroops(params);
      const preview = computeLimitAndBreakerPreview(fixture, amount);

      if (fixture.pauseState.isPaused) {
        throw new SimulationSdkError({
          code: 10,
          name: 'Unauthorized',
          description: 'Vault is paused; governance execution is blocked.',
          remediation: 'Wait for an emergency signer to unpause the vault.',
          rawMessage: 'HostError: Error(Contract, #10) vault paused',
        });
      }

      if (params.action === 'swap') {
        const oracleAge =
          fixture.currentLedger - fixture.oracleState.lastUpdatedLedger;
        if (oracleAge > fixture.oracleState.maxAgeLedgers) {
          throw new SimulationSdkError(
            parseTypedSdkError('HostError: Error(Contract, #1210)')
          );
        }
      }

      if (preview.willTripBreaker) {
        throw new SimulationSdkError(
          parseTypedSdkError('HostError: Error(Contract, #1224)')
        );
      }
      if (preview.perProposal.exceeds) {
        throw new SimulationSdkError(
          parseTypedSdkError('HostError: Error(Contract, #41)')
        );
      }
      if (preview.daily.exceeds) {
        throw new SimulationSdkError(
          parseTypedSdkError('HostError: Error(Contract, #42)')
        );
      }
      if (preview.weekly.exceeds) {
        throw new SimulationSdkError(
          parseTypedSdkError('HostError: Error(Contract, #43)')
        );
      }
      if (preview.insufficientSpendable) {
        throw new SimulationSdkError(
          parseTypedSdkError('HostError: Error(Contract, #70)')
        );
      }

      const profiles: Record<SimulationActionType, SorobanResourcePreview> = {
        create: {
          estimatedFeeStroops: 145_200n,
          resourceFeeStroops: 145_100n,
          baseFeeStroops: 100n,
          cpuInstructions: 1_850_000,
          memoryBytes: 620_000,
          readBytes: 4_200,
          writeBytes: 1_850,
          ledgerReads: 4,
          ledgerWrites: 2,
        },
        vote: {
          estimatedFeeStroops: 98_400n,
          resourceFeeStroops: 98_300n,
          baseFeeStroops: 100n,
          cpuInstructions: 1_120_000,
          memoryBytes: 410_000,
          readBytes: 3_100,
          writeBytes: 980,
          ledgerReads: 3,
          ledgerWrites: 1,
        },
        execute: {
          estimatedFeeStroops: 235_600n,
          resourceFeeStroops: 235_500n,
          baseFeeStroops: 100n,
          cpuInstructions: 3_420_000,
          memoryBytes: 940_000,
          readBytes: 6_800,
          writeBytes: 3_120,
          ledgerReads: 6,
          ledgerWrites: 3,
        },
        swap: {
          estimatedFeeStroops: 312_900n,
          resourceFeeStroops: 312_800n,
          baseFeeStroops: 100n,
          cpuInstructions: 4_890_000,
          memoryBytes: 1_280_000,
          readBytes: 9_400,
          writeBytes: 4_050,
          ledgerReads: 8,
          ledgerWrites: 4,
        },
      };

      const stateSummary: string[] = [];
      if (params.action === 'create') {
        stateSummary.push(
          `Create transfer proposal for ${formatStroopsToXlm(params.amountStroops)} XLM to ${params.recipient}`
        );
      } else if (params.action === 'vote') {
        stateSummary.push(
          `Record "${params.choice}" vote on proposal #${params.proposalId} (threshold ${fixture.threshold}/${fixture.signerCount})`
        );
      } else if (params.action === 'execute') {
        stateSummary.push(
          `Execute proposal #${params.proposalId} transferring ${formatStroopsToXlm(params.amountStroops)} XLM`
        );
      } else {
        stateSummary.push(
          `Swap ${formatStroopsToXlm(params.amountInStroops)} ${params.tokenIn} -> min ${formatStroopsToXlm(params.minAmountOutStroops)} ${params.tokenOut} via ${params.dex}`
        );
      }

      return {
        resources: profiles[params.action],
        stateSummary,
      };
    },
  };
}

/**
 * Execute a full dry-run simulation, combining SDK simulation resources,
 * contract-getter limit/breaker math, warning evaluation, and typed SDK error
 * parsing.
 */
export async function runSimulationLabDryRun(
  params: SimulationTxParams,
  fixture: ContractStateFixture,
  adapter: SimulationLabSdkAdapter = createDefaultSimulationAdapter()
): Promise<SimulationLabOutcome> {
  const txAmount = extractTxAmountStroops(params);
  const preview = computeLimitAndBreakerPreview(fixture, txAmount);
  const warnings = evaluateSimulationWarnings(fixture, params.action, preview);

  try {
    const sim = await adapter.simulate(params, fixture);
    return {
      ok: true,
      action: params.action,
      timestampIso: new Date().toISOString(),
      resources: sim.resources,
      preview,
      warnings,
      error: null,
      stateSummary: sim.stateSummary,
    };
  } catch (err) {
    return {
      ok: false,
      action: params.action,
      timestampIso: new Date().toISOString(),
      resources: null,
      preview,
      warnings,
      error: parseTypedSdkError(err),
      stateSummary: [],
    };
  }
}

/** Built-in fixture presets for rapid dry-run testing in the Simulation Lab UI. */
export const SIMULATION_LAB_FIXTURES: Record<
  'healthy' | 'paused' | 'staleOracle' | 'lowBreaker',
  ContractStateFixture
> = {
  healthy: {
    vaultId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    currentLedger: 120_500,
    threshold: 2,
    signerCount: 3,
    spendingLimitStroops: 100_000_000_000n, // 10,000 XLM
    dailyLimitStroops: 250_000_000_000n, // 25,000 XLM
    weeklyLimitStroops: 750_000_000_000n, // 75,000 XLM
    dailySpentStroops: 50_000_000_000n, // 5,000 XLM
    weeklySpentStroops: 150_000_000_000n, // 15,000 XLM
    balanceStroops: 500_000_000_000n, // 50,000 XLM
    earmarkedStroops: 50_000_000_000n, // 5,000 XLM
    pendingReservationsStroops: 20_000_000_000n, // 2,000 XLM
    lockedStroops: 30_000_000_000n, // 3,000 XLM
    breakerThresholdStroops: 150_000_000_000n, // 15,000 XLM / hr
    breakerWindowOutflowStroops: 30_000_000_000n, // 3,000 XLM
    breakerTripped: false,
    pauseState: {
      isPaused: false,
      pausedBy: null,
      pausedAtLedger: 0,
      cause: '',
    },
    oracleState: {
      lastUpdatedLedger: 120_485,
      maxAgeLedgers: 120,
      priceFeedSymbol: 'XLM/USDC',
    },
  },
  paused: {
    vaultId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    currentLedger: 120_500,
    threshold: 2,
    signerCount: 3,
    spendingLimitStroops: 100_000_000_000n,
    dailyLimitStroops: 250_000_000_000n,
    weeklyLimitStroops: 750_000_000_000n,
    dailySpentStroops: 50_000_000_000n,
    weeklySpentStroops: 150_000_000_000n,
    balanceStroops: 500_000_000_000n,
    earmarkedStroops: 50_000_000_000n,
    pendingReservationsStroops: 20_000_000_000n,
    lockedStroops: 30_000_000_000n,
    breakerThresholdStroops: 150_000_000_000n,
    breakerWindowOutflowStroops: 30_000_000_000n,
    breakerTripped: false,
    pauseState: {
      isPaused: true,
      pausedBy: 'GADMIN00000000000000000000000000000000000000000000000001',
      pausedAtLedger: 120_490,
      cause: 'manual_incident_response',
    },
    oracleState: {
      lastUpdatedLedger: 120_490,
      maxAgeLedgers: 120,
      priceFeedSymbol: 'XLM/USDC',
    },
  },
  staleOracle: {
    vaultId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    currentLedger: 120_500,
    threshold: 2,
    signerCount: 3,
    spendingLimitStroops: 100_000_000_000n,
    dailyLimitStroops: 250_000_000_000n,
    weeklyLimitStroops: 750_000_000_000n,
    dailySpentStroops: 50_000_000_000n,
    weeklySpentStroops: 150_000_000_000n,
    balanceStroops: 500_000_000_000n,
    earmarkedStroops: 50_000_000_000n,
    pendingReservationsStroops: 20_000_000_000n,
    lockedStroops: 30_000_000_000n,
    breakerThresholdStroops: 150_000_000_000n,
    breakerWindowOutflowStroops: 30_000_000_000n,
    breakerTripped: false,
    pauseState: {
      isPaused: false,
      pausedBy: null,
      pausedAtLedger: 0,
      cause: '',
    },
    oracleState: {
      lastUpdatedLedger: 120_100, // 400 ledgers old > 120 max
      maxAgeLedgers: 120,
      priceFeedSymbol: 'XLM/USDC',
    },
  },
  lowBreaker: {
    vaultId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    currentLedger: 120_500,
    threshold: 2,
    signerCount: 3,
    spendingLimitStroops: 100_000_000_000n,
    dailyLimitStroops: 250_000_000_000n,
    weeklyLimitStroops: 750_000_000_000n,
    dailySpentStroops: 200_000_000_000n,
    weeklySpentStroops: 600_000_000_000n,
    balanceStroops: 500_000_000_000n,
    earmarkedStroops: 50_000_000_000n,
    pendingReservationsStroops: 20_000_000_000n,
    lockedStroops: 30_000_000_000n,
    breakerThresholdStroops: 150_000_000_000n,
    breakerWindowOutflowStroops: 130_000_000_000n, // only 2,000 XLM left
    breakerTripped: false,
    pauseState: {
      isPaused: false,
      pausedBy: null,
      pausedAtLedger: 0,
      cause: '',
    },
    oracleState: {
      lastUpdatedLedger: 120_495,
      maxAgeLedgers: 120,
      priceFeedSymbol: 'XLM/USDC',
    },
  },
};
