import { describe, it, expect } from 'vitest';
import {
  simulate_proposal_effect,
  simulate_proposal_chain,
  normalizeAmount,
  getDefaultVaultState,
  type SimulatedProposal,
  type VaultStateInput,
} from '../vaultSimulator';

describe('Vault Simulator & Hypothetical Scenario Analysis', () => {
  const sampleProposal: SimulatedProposal = {
    id: '101',
    proposer: 'GXXXX1',
    recipient: 'GYYYY2',
    amount: '500', // 500 XLM
    token: 'NATIVE',
    tokenSymbol: 'XLM',
    status: 'Pending',
    approvals: 1,
    threshold: 2,
  };

  const sampleState: VaultStateInput = {
    balances: [
      {
        token: { address: 'NATIVE', symbol: 'XLM', name: 'Stellar Lumens', decimals: 7, isNative: true },
        balance: '2000',
      },
      {
        token: { address: 'CUSDC123', symbol: 'USDC', name: 'USD Coin', decimals: 7, isNative: false },
        balance: '5000',
      },
    ],
    spendingLimits: {
      spendingLimit: '1000', // 1,000 XLM per proposal limit
      dailyLimit: '2000',    // 2,000 XLM daily limit
      weeklyLimit: '5000',   // 5,000 XLM weekly limit
    },
    dailySpent: '300',
    weeklySpent: '1000',
    threshold: 2,
  };

  describe('normalizeAmount', () => {
    it('converts stroops to decimal XLM when >= 1,000,000', () => {
      expect(normalizeAmount('10000000')).toBe(1);
      expect(normalizeAmount(100000000)).toBe(10);
    });

    it('returns decimal numbers directly when < 1,000,000', () => {
      expect(normalizeAmount('500')).toBe(500);
      expect(normalizeAmount(25.5)).toBe(25.5);
    });

    it('handles null, undefined, and invalid inputs gracefully', () => {
      expect(normalizeAmount(null)).toBe(0);
      expect(normalizeAmount(undefined)).toBe(0);
      expect(normalizeAmount('invalid')).toBe(0);
    });
  });

  describe('simulate_proposal_effect', () => {
    it('calculates approval threshold transitions correctly', () => {
      // 1 approval out of 2 threshold -> threshold not met
      const res1 = simulate_proposal_effect(sampleProposal, 0, sampleState);
      expect(res1.initialApprovals).toBe(1);
      expect(res1.finalApprovals).toBe(1);
      expect(res1.willBeApproved).toBe(false);
      expect(res1.willBeExecuted).toBe(false);
      expect(res1.warnings.some((w) => w.includes('Threshold not met'))).toBe(true);

      // Adding 1 vote -> threshold met (2/2) -> executable
      const res2 = simulate_proposal_effect(sampleProposal, 1, sampleState);
      expect(res2.initialApprovals).toBe(1);
      expect(res2.finalApprovals).toBe(2);
      expect(res2.willBeApproved).toBe(true);
      expect(res2.willBeExecuted).toBe(true);
      expect(res2.success).toBe(true);
    });

    it('calculates projected balance deductions after execution', () => {
      const res = simulate_proposal_effect(sampleProposal, 1, sampleState);
      expect(res.success).toBe(true);

      const xlmBal = res.projectedBalances.find((b) => b.token.symbol === 'XLM');
      expect(xlmBal?.balance).toBe('1500'); // 2000 - 500 = 1500
    });

    it('tracks daily and weekly spending limit impacts', () => {
      const res = simulate_proposal_effect(sampleProposal, 1, sampleState);
      expect(res.spendingLimitImpact.dailyLimit.spentBefore).toBe(300);
      expect(res.spendingLimitImpact.dailyLimit.spentAfter).toBe(800); // 300 + 500
      expect(res.spendingLimitImpact.dailyLimit.exceeds).toBe(false);
      expect(res.spendingLimitImpact.dailyLimit.percentUsed).toBe(40); // 800 / 2000 = 40%

      expect(res.spendingLimitImpact.weeklyLimit.spentBefore).toBe(1000);
      expect(res.spendingLimitImpact.weeklyLimit.spentAfter).toBe(1500); // 1000 + 500
      expect(res.spendingLimitImpact.weeklyLimit.exceeds).toBe(false);
    });

    it('detects per-proposal spending limit violation', () => {
      const largeProp: SimulatedProposal = { ...sampleProposal, amount: '1500' }; // 1500 > 1000 limit
      const res = simulate_proposal_effect(largeProp, 1, sampleState);

      expect(res.spendingLimitImpact.perProposalLimit.exceeds).toBe(true);
      expect(res.errors.some((e) => e.includes('exceeds per-proposal spending limit'))).toBe(true);
      expect(res.success).toBe(false);
    });

    it('detects daily spending limit violation', () => {
      const stateNearDailyCap: VaultStateInput = {
        ...sampleState,
        dailySpent: '1800', // 1800 + 500 = 2300 > 2000 limit
      };

      const res = simulate_proposal_effect(sampleProposal, 1, stateNearDailyCap);
      expect(res.spendingLimitImpact.dailyLimit.exceeds).toBe(true);
      expect(res.errors.some((e) => e.includes('exceed daily spending limit'))).toBe(true);
      expect(res.success).toBe(false);
    });

    it('detects insufficient vault balance', () => {
      const lowBalState: VaultStateInput = {
        ...sampleState,
        balances: [
          {
            token: { address: 'NATIVE', symbol: 'XLM', name: 'Stellar Lumens', decimals: 7, isNative: true },
            balance: '100', // 100 < 500 needed
          },
        ],
      };

      const res = simulate_proposal_effect(sampleProposal, 1, lowBalState);
      expect(res.errors.some((e) => e.includes('Insufficient vault balance'))).toBe(true);
      expect(res.success).toBe(false);
    });

    it('handles already executed proposals', () => {
      const executedProp: SimulatedProposal = { ...sampleProposal, status: 'Executed' };
      const res = simulate_proposal_effect(executedProp, 0, sampleState);

      expect(res.isExecutedAlready).toBe(true);
      expect(res.willBeExecuted).toBe(false);
      expect(res.warnings.some((w) => w.includes('already executed'))).toBe(true);
    });
  });

  describe('simulate_proposal_chain (A -> B -> C)', () => {
    it('chains multiple proposals and computes accumulated impact step-by-step', () => {
      const propA: SimulatedProposal = { id: 'A', amount: '400', token: 'NATIVE', status: 'Pending', approvals: 1, threshold: 2, recipient: 'GA' };
      const propB: SimulatedProposal = { id: 'B', amount: '600', token: 'NATIVE', status: 'Pending', approvals: 1, threshold: 2, recipient: 'GB' };
      const propC: SimulatedProposal = { id: 'C', amount: '300', token: 'NATIVE', status: 'Pending', approvals: 1, threshold: 2, recipient: 'GC' };

      const chain = [
        { proposal: propA, votes_needed: 1 },
        { proposal: propB, votes_needed: 1 },
        { proposal: propC, votes_needed: 1 },
      ];

      const res = simulate_proposal_chain(chain, sampleState);

      expect(res.overallSuccess).toBe(true);
      expect(res.steps).toHaveLength(3);
      expect(res.totalAmountSimulated).toBe(1300); // 400 + 600 + 300 = 1300

      // Step A
      expect(res.steps[0].spendingLimitImpact.dailyLimit.spentBefore).toBe(300);
      expect(res.steps[0].spendingLimitImpact.dailyLimit.spentAfter).toBe(700);

      // Step B
      expect(res.steps[1].spendingLimitImpact.dailyLimit.spentBefore).toBe(700);
      expect(res.steps[1].spendingLimitImpact.dailyLimit.spentAfter).toBe(1300);

      // Step C
      expect(res.steps[2].spendingLimitImpact.dailyLimit.spentBefore).toBe(1300);
      expect(res.steps[2].spendingLimitImpact.dailyLimit.spentAfter).toBe(1600);

      // Final Vault Balance
      const finalXlm = res.finalVaultState.balances.find((b) => b.token.symbol === 'XLM');
      expect(finalXlm?.balance).toBe('700'); // 2000 - 1300 = 700
    });

    it('identifies the exact step where a chain fails due to daily limit overspill', () => {
      const propA: SimulatedProposal = { id: 'A', amount: '900', token: 'NATIVE', status: 'Pending', approvals: 1, threshold: 2, recipient: 'GA' };
      const propB: SimulatedProposal = { id: 'B', amount: '900', token: 'NATIVE', status: 'Pending', approvals: 1, threshold: 2, recipient: 'GB' }; // 300 + 900 + 900 = 2100 > 2000 daily limit

      const chain = [
        { proposal: propA, votes_needed: 1 },
        { proposal: propB, votes_needed: 1 },
      ];

      const res = simulate_proposal_chain(chain, sampleState);

      expect(res.overallSuccess).toBe(false);
      expect(res.failedStepIndex).toBe(1); // Step B failed
      expect(res.steps[0].success).toBe(true);
      expect(res.steps[1].success).toBe(false);
      expect(res.steps[1].errors.some((e) => e.includes('exceed daily spending limit'))).toBe(true);
    });
  });
});
