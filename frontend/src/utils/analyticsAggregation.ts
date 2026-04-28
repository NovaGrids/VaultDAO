/**
 * Aggregate vault activities into analytics series for charts and stats.
 */

import type {
  ActivityLike,
  AggregatedAnalytics,
  ProposalTrendPoint,
  SpendingSlice,
  SignerActivityCell,
  TreasuryBalancePoint,
  AnalyticsTimeRange,
} from '../types/analytics';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

export function filterTransactionsByDateRange<T extends { timestamp: string }>(
  transactions: T[],
  from?: string,
  to?: string
): T[] {
  const fromTime = from ? new Date(from).getTime() : 0;
  const toTime = to ? new Date(to).setHours(23, 59, 59, 999) : Infinity;
  
  return transactions.filter((t) => {
    const time = new Date(t.timestamp).getTime();
    return time >= fromTime && time <= toTime;
  });
}

function getRangeDates(range: AnalyticsTimeRange): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case '7d':
      start.setTime(end.getTime() - 7 * MS_PER_DAY);
      break;
    case '30d':
      start.setTime(end.getTime() - 30 * MS_PER_DAY);
      break;
    case '90d':
      start.setTime(end.getTime() - 90 * MS_PER_DAY);
      break;
    case '1y':
      start.setTime(end.getTime() - 365 * MS_PER_DAY);
      break;
    default:
      start.setTime(0);
  }
  return { start, end };
}

function inRange(ts: string, start: Date, end: Date): boolean {
  const t = new Date(ts).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function getWeekKey(iso: string): string {
  const d = new Date(iso);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return start.toISOString().slice(0, 10);
}

export function aggregateProposalTrends(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): ProposalTrendPoint[] {
  const { start, end } = getRangeDates(range);
  const byDate: Record<string, { created: number; approved: number; executed: number }> = {};
  const addDate = (key: string) => {
    if (!byDate[key]) byDate[key] = { created: 0, approved: 0, executed: 0 };
  };
  activities.forEach((a) => {
    if (!inRange(a.timestamp, start, end)) return;
    const key = toDateKey(a.timestamp);
    addDate(key);
    if (a.type === 'proposal_created') byDate[key].created += 1;
    else if (a.type === 'proposal_approved') byDate[key].approved += 1;
    else if (a.type === 'proposal_executed') byDate[key].executed += 1;
  });
  const sorted = Object.keys(byDate).sort();
  return sorted.map((date) => ({
    date,
    created: byDate[date].created,
    approved: byDate[date].approved,
    executed: byDate[date].executed,
  }));
}

export function aggregateSpendingByToken(activities: ActivityLike[]): SpendingSlice[] {
  const byToken: Record<string, { value: number; count: number }> = {};
  activities.forEach((a) => {
    if (a.type !== 'proposal_executed') return;
    const amount = Number(a.details?.amount ?? 0) || 0;
    const token = (a.details?.recipient ? String(a.details.recipient).slice(0, 8) : 'Unknown') || 'Unknown';
    if (!byToken[token]) byToken[token] = { value: 0, count: 0 };
    byToken[token].value += amount;
    byToken[token].count += 1;
  });
  return Object.entries(byToken).map(([name, { value, count }]) => ({ name, value, count }));
}

export function aggregateSignerActivity(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): SignerActivityCell[] {
  const { start, end } = getRangeDates(range);
  const bySignerPeriod: Record<string, number> = {};
  activities.forEach((a) => {
    if (a.type !== 'proposal_approved' || !inRange(a.timestamp, start, end)) return;
    const signer = a.actor || 'unknown';
    const period = getWeekKey(a.timestamp);
    const key = `${signer}|${period}`;
    bySignerPeriod[key] = (bySignerPeriod[key] || 0) + 1;
  });
  return Object.entries(bySignerPeriod).map(([key, count]) => {
    const [signer, period] = key.split('|');
    return { signer, period, count };
  });
}

export function aggregateTreasuryBalance(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): TreasuryBalancePoint[] {
  const { start, end } = getRangeDates(range);
  const byDate: Record<string, Record<string, number>> = {};
  let running = 0;
  const executed = activities
    .filter((a) => a.type === 'proposal_executed' && inRange(a.timestamp, start, end))
    .map((a) => ({ date: toDateKey(a.timestamp), amount: Number(a.details?.amount ?? 0) || 0 }))
    .sort((x, y) => x.date.localeCompare(y.date));
  executed.forEach(({ date, amount }) => {
    running += amount;
    if (!byDate[date]) byDate[date] = { total: 0 };
    byDate[date].total = running;
  });
  const sorted = Object.keys(byDate).sort();
  return sorted.map((date) => ({ date, ...byDate[date] }));
}

export function computeStats(activities: ActivityLike[]): Pick<
  AggregatedAnalytics,
  'approvalRate' | 'averageApprovalTimeHours' | 'mostActiveSigner' | 'topRecipient' | 'totalVolume' | 'pendingCount'
> {
  const created = activities.filter((a) => a.type === 'proposal_created');
  const approved = activities.filter((a) => a.type === 'proposal_approved');
  const executed = activities.filter((a) => a.type === 'proposal_executed');
  const rejected = activities.filter((a) => a.type === 'proposal_rejected');
  const totalResolved = executed.length + rejected.length;
  const approvalRate = totalResolved ? (executed.length / totalResolved) * 100 : 0;

  const createdByProposal: Record<string, string> = {};
  created.forEach((a) => {
    const id = (a.details?.ledger ?? a.id) as string;
    createdByProposal[id] = a.timestamp;
  });
  let sumHours = 0;
  let count = 0;
  approved.forEach((a) => {
    const createdTs = createdByProposal[(a.details?.ledger ?? a.id) as string];
    if (createdTs) {
      sumHours += (new Date(a.timestamp).getTime() - new Date(createdTs).getTime()) / (60 * 60 * 1000);
      count += 1;
    }
  });
  const averageApprovalTimeHours = count ? sumHours / count : 0;

  const signerCount: Record<string, number> = {};
  approved.forEach((a) => {
    const s = a.actor || 'unknown';
    signerCount[s] = (signerCount[s] || 0) + 1;
  });
  const mostActiveSigner =
    Object.entries(signerCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  const recipientCount: Record<string, number> = {};
  executed.forEach((a) => {
    const r = (a.details?.recipient as string) || 'unknown';
    recipientCount[r] = (recipientCount[r] || 0) + 1;
  });
  const topRecipient =
    Object.entries(recipientCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  const totalVolume = executed.reduce(
    (s, a) => s + (Number(a.details?.amount ?? 0) || 0),
    0
  );

  const pendingCount = Math.max(0, created.length - executed.length - rejected.length);

  return {
    approvalRate,
    averageApprovalTimeHours,
    mostActiveSigner,
    topRecipient,
    totalVolume,
    pendingCount,
  };
}

export function aggregateAnalytics(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): AggregatedAnalytics {
  const stats = computeStats(activities);
  return {
    proposalTrends: aggregateProposalTrends(activities, range),
    spendingByToken: aggregateSpendingByToken(activities),
    signerActivity: aggregateSignerActivity(activities, range),
    treasuryBalance: aggregateTreasuryBalance(activities, range),
    ...stats,
    dailyLimitUsedPercent: undefined,
  };
}

export interface DailySpendingPoint {
  date: string;
  amount: number;
}

export interface ProposalOutcome {
  name: 'Executed' | 'Rejected' | 'Pending';
  value: number;
}

export interface RecipientBar {
  address: string;
  total: number;
  count: number;
}

export interface SignerRow {
  signer: string;
  approvals: number;
  rate: number; // 0-100
}

export function aggregateDailySpending(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): DailySpendingPoint[] {
  const { start, end } = getRangeDates(range);
  const byDate: Record<string, number> = {};
  activities.forEach((a) => {
    if (a.type !== 'proposal_executed' || !inRange(a.timestamp, start, end)) return;
    const key = toDateKey(a.timestamp);
    byDate[key] = (byDate[key] ?? 0) + (Number(a.details?.amount ?? 0) || 0);
  });
  return Object.keys(byDate).sort().map((date) => ({ date, amount: byDate[date] }));
}

export function aggregateProposalOutcomes(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): ProposalOutcome[] {
  const { start, end } = getRangeDates(range);
  const inR = (a: ActivityLike) => inRange(a.timestamp, start, end);
  const executed = activities.filter((a) => a.type === 'proposal_executed' && inR(a)).length;
  const rejected = activities.filter((a) => a.type === 'proposal_rejected' && inR(a)).length;
  const created = activities.filter((a) => a.type === 'proposal_created' && inR(a)).length;
  const pending = Math.max(0, created - executed - rejected);
  return [
    { name: 'Executed', value: executed },
    { name: 'Rejected', value: rejected },
    { name: 'Pending', value: pending },
  ].filter((o) => o.value > 0);
}

export function aggregateTopRecipients(
  activities: ActivityLike[],
  range: AnalyticsTimeRange,
  limit = 5
): RecipientBar[] {
  const { start, end } = getRangeDates(range);
  const byRecipient: Record<string, { total: number; count: number }> = {};
  activities.forEach((a) => {
    if (a.type !== 'proposal_executed' || !inRange(a.timestamp, start, end)) return;
    const addr = String(a.details?.recipient ?? 'unknown');
    if (!byRecipient[addr]) byRecipient[addr] = { total: 0, count: 0 };
    byRecipient[addr].total += Number(a.details?.amount ?? 0) || 0;
    byRecipient[addr].count += 1;
  });
  return Object.entries(byRecipient)
    .map(([address, { total, count }]) => ({ address, total, count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function aggregateSignerParticipation(
  activities: ActivityLike[],
  range: AnalyticsTimeRange
): SignerRow[] {
  const { start, end } = getRangeDates(range);
  const totalProposals = activities.filter(
    (a) => a.type === 'proposal_created' && inRange(a.timestamp, start, end)
  ).length;
  const byApprover: Record<string, number> = {};
  activities.forEach((a) => {
    if (a.type !== 'proposal_approved' || !inRange(a.timestamp, start, end)) return;
    const s = a.actor || 'unknown';
    byApprover[s] = (byApprover[s] ?? 0) + 1;
  });
  return Object.entries(byApprover)
    .map(([signer, approvals]) => ({
      signer,
      approvals,
      rate: totalProposals > 0 ? Math.min(100, (approvals / totalProposals) * 100) : 0,
    }))
    .sort((a, b) => b.approvals - a.approvals);
}
