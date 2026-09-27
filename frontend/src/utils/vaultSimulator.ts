import type { TokenBalance } from '../types';
import type { StateChange } from './simulation';
import { stroopsToDecimal } from './amount';

export interface SimulatedProposal {
  id: string;
  proposer?: string;
  recipient: string;
  amount: string; // amount string in decimal or stroops
  token: string;
  tokenSymbol?: string;
  memo?: string;
  status: string; // 'Pending' | 'Approved' | 'Executed' | 'Rejected'
  approvals: number;
  threshold: number;
  approvedBy?: string[];
  createdAt?: string;
}

export interface SpendingLimitsConfig {
  spendingLimit: string | number; // per-proposal limit
  dailyLimit: string | number;    // daily limit
  weeklyLimit: string | number;   // weekly limit
}

export interface VaultStateInput {
  balances: TokenBalance[];
  spendingLimits: SpendingLimitsConfig;
  dailySpent: string | number;
  weeklySpent: string | number;
  threshold: number;
}

export interface LimitCheckResult {
  limit: number;
  spentBefore: number;
  spentAfter: number;
  amount: number;
  percentUsed: number;
  exceeds: boolean;
}

export interface SpendingLimitImpact {
  perProposalLimit: {
    limit: number;
    amount: number;
    exceeds: boolean;
  };
  dailyLimit: LimitCheckResult;
  weeklyLimit: LimitCheckResult;
}

export interface SimulationEffectResult {
  proposalId: string;
  initialApprovals: number;
  addedVotes: number;
  finalApprovals: number;
  threshold: number;
  willBeApproved: boolean;
  willBeExecuted: boolean;
  isExecutedAlready: boolean;
  isRejected: boolean;
  projectedBalances: TokenBalance[];
  spendingLimitImpact: SpendingLimitImpact;
  warnings: string[];
  errors: string[];
  stateChanges: StateChange[];
  success: boolean;
  updatedVaultState: VaultStateInput;
}

export interface ChainItem {
  proposal: SimulatedProposal;
  votes_needed: number;
}

export interface ChainedSimulationResult {
  steps: SimulationEffectResult[];
  initialVaultState: VaultStateInput;
  finalVaultState: VaultStateInput;
  overallSuccess: boolean;
  totalAmountSimulated: number;
  failedStepIndex: number;
}

/**
 * Normalizes amount values (stroops or decimal string/number) into a standard decimal XLM/token amount.
 */
export function normalizeAmount(val: string | number | undefined | null): number {
  if (val === null || val === undefined) return 0;
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return 0;
  // If amount is >= 1,000,000 (typical stroop threshold for XLM integer values), convert from stroops.
  if (num >= 1_000_000) {
    return stroopsToDecimal(num);
  }
  return num;
}

/**
 * Helper to get fallback initial vault state if none provided.
 */
export function getDefaultVaultState(balances: TokenBalance[] = []): VaultStateInput {
  return {
    balances: balances.length > 0 ? balances : [
      {
        token: {
          address: 'NATIVE',
          symbol: 'XLM',
          name: 'Stellar Lumens',
          decimals: 7,
          isNative: true,
        },
        balance: '10000',
      },
    ],
    spendingLimits: {
      spendingLimit: '100000000000', // 10,000 XLM
      dailyLimit: '500000000000',    // 50,000 XLM
      weeklyLimit: '2000000000000',  // 200,000 XLM
    },
    dailySpent: '0',
    weeklySpent: '0',
    threshold: 2,
  };
}

/**
 * Simulates the hypothetical effect of approving and/or executing a proposal.
 *
 * @param proposal The proposal object to simulate
 * @param votes_needed Additional simulated votes/approvals to add
 * @param currentState The current (or intermediate) state of the vault
 */
export function simulate_proposal_effect(
  proposal: SimulatedProposal,
  votes_needed: number = 0,
  currentState?: VaultStateInput
): SimulationEffectResult {
  const vaultState = currentState || getDefaultVaultState();
  const initialApprovals = proposal.approvals || 0;
  const addedVotes = Math.max(0, votes_needed);
  const finalApprovals = initialApprovals + addedVotes;
  const effectiveThreshold = proposal.threshold || vaultState.threshold || 1;

  const isExecutedAlready = proposal.status === 'Executed';
  const isRejected = proposal.status === 'Rejected';

  const willBeApproved = proposal.status === 'Approved' || finalApprovals >= effectiveThreshold;
  const willBeExecuted = !isExecutedAlready && !isRejected && willBeApproved;

  const proposalAmount = normalizeAmount(proposal.amount);
  const perPropLimit = normalizeAmount(vaultState.spendingLimits.spendingLimit);
  const dailyLimit = normalizeAmount(vaultState.spendingLimits.dailyLimit);
  const weeklyLimit = normalizeAmount(vaultState.spendingLimits.weeklyLimit);

  const dailySpentBefore = normalizeAmount(vaultState.dailySpent);
  const weeklySpentBefore = normalizeAmount(vaultState.weeklySpent);

  const dailySpentAfter = willBeExecuted ? dailySpentBefore + proposalAmount : dailySpentBefore;
  const weeklySpentAfter = willBeExecuted ? weeklySpentBefore + proposalAmount : weeklySpentBefore;

  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Spending limit checks
  const perPropExceeds = perPropLimit > 0 && proposalAmount > perPropLimit;
  if (perPropExceeds) {
    errors.push(
      `Proposal amount (${proposalAmount.toLocaleString()} XLM) exceeds per-proposal spending limit (${perPropLimit.toLocaleString()} XLM)`
    );
  }

  const dailyExceeds = dailyLimit > 0 && dailySpentAfter > dailyLimit;
  const dailyPercent = dailyLimit > 0 ? (dailySpentAfter / dailyLimit) * 100 : 0;
  if (dailyExceeds && willBeExecuted) {
    errors.push(
      `Execution would exceed daily spending limit (${dailySpentAfter.toLocaleString()} / ${dailyLimit.toLocaleString()} XLM)`
    );
  } else if (dailyPercent > 80 && dailyLimit > 0 && willBeExecuted) {
    warnings.push(`Execution consumes ${dailyPercent.toFixed(1)}% of daily spending limit`);
  }

  const weeklyExceeds = weeklyLimit > 0 && weeklySpentAfter > weeklyLimit;
  const weeklyPercent = weeklyLimit > 0 ? (weeklySpentAfter / weeklyLimit) * 100 : 0;
  if (weeklyExceeds && willBeExecuted) {
    errors.push(
      `Execution would exceed weekly spending limit (${weeklySpentAfter.toLocaleString()} / ${weeklyLimit.toLocaleString()} XLM)`
    );
  } else if (weeklyPercent > 80 && weeklyLimit > 0 && willBeExecuted) {
    warnings.push(`Execution consumes ${weeklyPercent.toFixed(1)}% of weekly spending limit`);
  }

  // 2. Token balance impact
  const tokenSymbol = proposal.tokenSymbol || proposal.token || 'XLM';
  let targetTokenIndex = vaultState.balances.findIndex(
    (b) =>
      b.token.symbol.toUpperCase() === tokenSymbol.toUpperCase() ||
      b.token.address.toUpperCase() === proposal.token.toUpperCase()
  );

  if (targetTokenIndex === -1 && vaultState.balances.length > 0) {
    targetTokenIndex = 0; // Default to first token if specific match not found
  }

  const projectedBalances: TokenBalance[] = vaultState.balances.map((b, idx) => {
    if (idx === targetTokenIndex && willBeExecuted) {
      const currentBal = parseFloat(b.balance) || 0;
      const newBal = currentBal - proposalAmount;
      return {
        ...b,
        balance: Math.max(0, newBal).toString(),
      };
    }
    return { ...b };
  });

  if (targetTokenIndex !== -1 && willBeExecuted) {
    const currentBal = parseFloat(vaultState.balances[targetTokenIndex].balance) || 0;
    if (currentBal < proposalAmount) {
      errors.push(
        `Insufficient vault balance for ${vaultState.balances[targetTokenIndex].token.symbol} (Available: ${currentBal.toLocaleString()}, Required: ${proposalAmount.toLocaleString()})`
      );
    }
  }

  // 3. Status and approval warnings
  if (isExecutedAlready) {
    warnings.push(`Proposal #${proposal.id} is already executed.`);
  } else if (isRejected) {
    errors.push(`Proposal #${proposal.id} was rejected.`);
  } else if (!willBeApproved) {
    warnings.push(
      `Threshold not met (${finalApprovals}/${effectiveThreshold} votes). ${effectiveThreshold - finalApprovals} more vote(s) required.`
    );
  }

  // 4. Construct state changes
  const stateChanges: StateChange[] = [];

  stateChanges.push({
    type: 'approval',
    description: 'Vote Count Transition',
    before: `${initialApprovals}/${effectiveThreshold} votes`,
    after: `${finalApprovals}/${effectiveThreshold} votes (${willBeApproved ? 'Threshold Met' : 'Pending'})`,
  });

  if (willBeExecuted) {
    const sym = targetTokenIndex !== -1 ? vaultState.balances[targetTokenIndex].token.symbol : 'XLM';
    const beforeBal = targetTokenIndex !== -1 ? parseFloat(vaultState.balances[targetTokenIndex].balance) || 0 : 0;
    const afterBal = beforeBal - proposalAmount;

    stateChanges.push({
      type: 'proposal',
      description: 'Proposal Status',
      before: proposal.status,
      after: 'Executed',
    });

    stateChanges.push({
      type: 'balance',
      description: `${sym} Vault Balance`,
      before: `${beforeBal.toLocaleString()} ${sym}`,
      after: `${afterBal.toLocaleString()} ${sym}`,
    });

    if (dailyLimit > 0) {
      stateChanges.push({
        type: 'config',
        description: 'Daily Spent Accumulation',
        before: `${dailySpentBefore.toLocaleString()} / ${dailyLimit.toLocaleString()} XLM`,
        after: `${dailySpentAfter.toLocaleString()} / ${dailyLimit.toLocaleString()} XLM (${dailyPercent.toFixed(0)}%)`,
      });
    }

    if (weeklyLimit > 0) {
      stateChanges.push({
        type: 'config',
        description: 'Weekly Spent Accumulation',
        before: `${weeklySpentBefore.toLocaleString()} / ${weeklyLimit.toLocaleString()} XLM`,
        after: `${weeklySpentAfter.toLocaleString()} / ${weeklyLimit.toLocaleString()} XLM (${weeklyPercent.toFixed(0)}%)`,
      });
    }
  }

  const spendingLimitImpact: SpendingLimitImpact = {
    perProposalLimit: {
      limit: perPropLimit,
      amount: proposalAmount,
      exceeds: perPropExceeds,
    },
    dailyLimit: {
      limit: dailyLimit,
      spentBefore: dailySpentBefore,
      spentAfter: dailySpentAfter,
      amount: proposalAmount,
      percentUsed: dailyPercent,
      exceeds: dailyExceeds,
    },
    weeklyLimit: {
      limit: weeklyLimit,
      spentBefore: weeklySpentBefore,
      spentAfter: weeklySpentAfter,
      amount: proposalAmount,
      percentUsed: weeklyPercent,
      exceeds: weeklyExceeds,
    },
  };

  const updatedVaultState: VaultStateInput = {
    ...vaultState,
    balances: projectedBalances,
    dailySpent: dailySpentAfter,
    weeklySpent: weeklySpentAfter,
  };

  const success = errors.length === 0 && (willBeExecuted || isExecutedAlready);

  return {
    proposalId: proposal.id,
    initialApprovals,
    addedVotes,
    finalApprovals,
    threshold: effectiveThreshold,
    willBeApproved,
    willBeExecuted,
    isExecutedAlready,
    isRejected,
    projectedBalances,
    spendingLimitImpact,
    warnings,
    errors,
    stateChanges,
    success,
    updatedVaultState,
  };
}

/**
 * Simulates a chain of proposal executions in sequence (A → B → C).
 *
 * @param chainItems Array of proposal + simulated votes to execute sequentially
 * @param initialVaultState Starting vault state
 */
export function simulate_proposal_chain(
  chainItems: ChainItem[],
  initialVaultState?: VaultStateInput
): ChainedSimulationResult {
  const startState = initialVaultState || getDefaultVaultState();
  let currentState = startState;
  const steps: SimulationEffectResult[] = [];
  let overallSuccess = true;
  let totalAmountSimulated = 0;
  let failedStepIndex = -1;

  for (let i = 0; i < chainItems.length; i++) {
    const item = chainItems[i];
    const stepResult = simulate_proposal_effect(item.proposal, item.votes_needed, currentState);
    steps.push(stepResult);

    if (stepResult.willBeExecuted) {
      totalAmountSimulated += normalizeAmount(item.proposal.amount);
    }

    if (!stepResult.success) {
      overallSuccess = false;
      if (failedStepIndex === -1) {
        failedStepIndex = i;
      }
    }

    currentState = stepResult.updatedVaultState;
  }

  return {
    steps,
    initialVaultState: startState,
    finalVaultState: currentState,
    overallSuccess,
    totalAmountSimulated,
    failedStepIndex,
  };
}
