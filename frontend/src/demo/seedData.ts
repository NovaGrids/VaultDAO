import type { Proposal } from '../app/dashboard/Proposals';
import type { GetVaultEventsResult, VaultActivity } from '../types/activity';
import type { TokenBalance } from '../types';
import { DEFAULT_TOKENS } from '../constants/tokens';

/** Valid-length G-addresses for UI display (demo only). */
const SIGNERS = [
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2345',
  'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC6789',
  'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDE0123',
] as const;

function daysAgo(days: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const DEMO_DASHBOARD_STATS = {
  totalBalance: '12,500.00',
  totalProposals: 4,
  pendingApprovals: 2,
  readyToExecute: 1,
  activeSigners: 4,
  threshold: '3/4',
};

/** Balance in stroops for Overview formatTokenAmount */
export const DEMO_VAULT_BALANCE_STROOPS = String(12_500 * 10_000_000);

export const DEMO_TOKEN_BALANCES: TokenBalance[] = [
  { token: DEFAULT_TOKENS[0], balance: '12500.0000000', isLoading: false },
  { token: DEFAULT_TOKENS[1], balance: '4200.0000000', isLoading: false },
  { token: DEFAULT_TOKENS[2], balance: '150.0000000', isLoading: false },
  { token: DEFAULT_TOKENS[3], balance: '890.0000000', isLoading: false },
];

export const DEMO_PORTFOLIO_USD = '16840.50';

export const DEMO_VAULT_CONFIG = {
  signers: [...SIGNERS] as string[],
  threshold: 3,
  spendingLimit: '50000000000',
  dailyLimit: '100000000000',
  weeklyLimit: '500000000000',
  timelockThreshold: '10000000000',
  timelockDelay: 17280,
  currentUserRole: 1,
  isCurrentUserSigner: true,
};

export const DEMO_PROPOSALS: Proposal[] = [
  {
    id: '101',
    proposer: SIGNERS[1],
    recipient: 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE4567',
    amount: '25000000000',
    token: 'NATIVE',
    tokenSymbol: 'XLM',
    memo: 'Monthly payroll — March',
    status: 'Pending',
    approvals: 2,
    threshold: 3,
    approvedBy: [SIGNERS[0], SIGNERS[1]],
    createdAt: daysAgo(1, 9),
  },
  {
    id: '102',
    proposer: SIGNERS[0],
    recipient: 'GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF8901',
    amount: '8500000000',
    token: 'NATIVE',
    tokenSymbol: 'XLM',
    memo: 'Vendor payment — audit firm',
    status: 'Pending',
    approvals: 1,
    threshold: 3,
    approvedBy: [SIGNERS[0]],
    createdAt: daysAgo(2, 14),
  },
  {
    id: '103',
    proposer: SIGNERS[2],
    recipient: 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG2345',
    amount: '5000000000',
    token: 'NATIVE',
    tokenSymbol: 'XLM',
    memo: 'Community grant batch #12',
    status: 'Approved',
    approvals: 3,
    threshold: 3,
    approvedBy: [SIGNERS[0], SIGNERS[1], SIGNERS[2]],
    createdAt: daysAgo(4, 11),
  },
  {
    id: '98',
    proposer: SIGNERS[1],
    recipient: 'GHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH6789',
    amount: '10000000000',
    token: 'NATIVE',
    tokenSymbol: 'XLM',
    memo: 'USDC liquidity top-up',
    status: 'Executed',
    approvals: 3,
    threshold: 3,
    approvedBy: [SIGNERS[0], SIGNERS[1], SIGNERS[2]],
    createdAt: daysAgo(8, 16),
  },
  {
    id: '95',
    proposer: SIGNERS[3],
    recipient: 'GIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII0123',
    amount: '1200000000',
    token: 'NATIVE',
    tokenSymbol: 'XLM',
    memo: 'Ops tooling subscription',
    status: 'Rejected',
    approvals: 1,
    threshold: 3,
    approvedBy: [SIGNERS[3]],
    createdAt: daysAgo(12, 10),
  },
];

function activity(
  partial: Omit<VaultActivity, 'id' | 'ledger' | 'pagingToken'> & { id?: string },
): VaultActivity {
  return {
    id: partial.id ?? partial.eventId,
    ledger: '1',
    ...partial,
  };
}

export function getDemoVaultEvents(): GetVaultEventsResult {
  const activities: VaultActivity[] = [
    activity({
      type: 'proposal_created',
      timestamp: daysAgo(1, 9),
      actor: SIGNERS[1],
      eventId: '101-created',
      details: {
        proposer: SIGNERS[1],
        recipient: DEMO_PROPOSALS[0].recipient,
        amount: DEMO_PROPOSALS[0].amount,
        memo: DEMO_PROPOSALS[0].memo,
      },
    }),
    activity({
      type: 'proposal_approved',
      timestamp: daysAgo(1, 10),
      actor: SIGNERS[0],
      eventId: '101-approved-1',
      details: { approval_count: 1, threshold: 3 },
    }),
    activity({
      type: 'proposal_approved',
      timestamp: daysAgo(1, 11),
      actor: SIGNERS[1],
      eventId: '101-approved-2',
      details: { approval_count: 2, threshold: 3 },
    }),
    activity({
      type: 'proposal_created',
      timestamp: daysAgo(2, 14),
      actor: SIGNERS[0],
      eventId: '102-created',
      details: {
        proposer: SIGNERS[0],
        recipient: DEMO_PROPOSALS[1].recipient,
        amount: DEMO_PROPOSALS[1].amount,
        memo: DEMO_PROPOSALS[1].memo,
      },
    }),
    activity({
      type: 'proposal_approved',
      timestamp: daysAgo(2, 15),
      actor: SIGNERS[0],
      eventId: '102-approved-1',
      details: { approval_count: 1, threshold: 3 },
    }),
    activity({
      type: 'proposal_created',
      timestamp: daysAgo(4, 11),
      actor: SIGNERS[2],
      eventId: '103-created',
      details: {
        proposer: SIGNERS[2],
        recipient: DEMO_PROPOSALS[2].recipient,
        amount: DEMO_PROPOSALS[2].amount,
        memo: DEMO_PROPOSALS[2].memo,
      },
    }),
    activity({
      type: 'proposal_approved',
      timestamp: daysAgo(4, 12),
      actor: SIGNERS[0],
      eventId: '103-approved-1',
      details: { approval_count: 1, threshold: 3 },
    }),
    activity({
      type: 'proposal_approved',
      timestamp: daysAgo(4, 13),
      actor: SIGNERS[1],
      eventId: '103-approved-2',
      details: { approval_count: 2, threshold: 3 },
    }),
    activity({
      type: 'proposal_approved',
      timestamp: daysAgo(4, 14),
      actor: SIGNERS[2],
      eventId: '103-approved-3',
      details: { approval_count: 3, threshold: 3 },
    }),
    activity({
      type: 'proposal_ready',
      timestamp: daysAgo(3, 9),
      actor: SIGNERS[2],
      eventId: '103-ready',
      details: {},
    }),
    activity({
      type: 'proposal_created',
      timestamp: daysAgo(8, 16),
      actor: SIGNERS[1],
      eventId: '98-created',
      details: {
        proposer: SIGNERS[1],
        recipient: DEMO_PROPOSALS[3].recipient,
        amount: DEMO_PROPOSALS[3].amount,
        memo: DEMO_PROPOSALS[3].memo,
      },
    }),
    activity({
      type: 'proposal_executed',
      timestamp: daysAgo(7, 10),
      actor: SIGNERS[0],
      eventId: '98-executed',
      details: { amount: DEMO_PROPOSALS[3].amount },
    }),
    activity({
      type: 'proposal_created',
      timestamp: daysAgo(12, 10),
      actor: SIGNERS[3],
      eventId: '95-created',
      details: {
        proposer: SIGNERS[3],
        recipient: DEMO_PROPOSALS[4].recipient,
        amount: DEMO_PROPOSALS[4].amount,
        memo: DEMO_PROPOSALS[4].memo,
      },
    }),
    activity({
      type: 'proposal_rejected',
      timestamp: daysAgo(11, 16),
      actor: SIGNERS[0],
      eventId: '95-rejected',
      details: {},
    }),
    activity({
      type: 'proposal_executed',
      timestamp: daysAgo(5, 12),
      actor: SIGNERS[1],
      eventId: '90-executed',
      details: { amount: '3200000000', recipient: 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE4567' },
    }),
    activity({
      type: 'proposal_executed',
      timestamp: daysAgo(9, 15),
      actor: SIGNERS[2],
      eventId: '88-executed',
      details: { amount: '7500000000', recipient: 'GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF8901' },
    }),
    activity({
      type: 'proposal_executed',
      timestamp: daysAgo(14, 11),
      actor: SIGNERS[0],
      eventId: '80-executed',
      details: { amount: '15000000000', recipient: 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG2345' },
    }),
  ];

  return {
    activities: activities.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    ),
    latestLedger: '2500000',
    hasMore: false,
  };
}
