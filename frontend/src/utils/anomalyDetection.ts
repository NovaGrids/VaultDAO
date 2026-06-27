export interface Anomaly {
  id: string;
  type: 'amount' | 'frequency' | 'recipient';
  severity: 'medium' | 'high' | 'info';
  message: string;
  proposalId?: string;
  timestamp: number;
}

export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

export function detectAmountAnomalies(proposals: { id: string; amount: number }[]): Anomaly[] {
  if (proposals.length < 3) return [];

  const amounts = proposals.map(p => p.amount);
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const stdDev = Math.sqrt(
    amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length
  );

  return proposals
    .map(p => {
      const z = Math.abs(calculateZScore(p.amount, mean, stdDev));
      if (z > 2.5) {
        const anomaly: Anomaly = {
          id: `anomaly-amount-${p.id}`,
          type: 'amount',
          severity: z > 4 ? 'high' : 'medium',
          message: `Unusual amount detected: ${p.amount.toLocaleString()}`,
          proposalId: p.id,
          timestamp: Date.now(),
        };
        return anomaly;
      }
      return null;
    })
    .filter((a): a is Anomaly => a !== null);
}

export function detectFrequencyAnomalies(
  proposals: { id: string; timestamp: number }[],
  windowHours = 24
): Anomaly[] {
  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  const recentProposals = proposals.filter(p => now - p.timestamp < windowMs);

  // If more than 5 proposals in 24 hours, it's a burst
  if (recentProposals.length > 5) {
    return [{
      id: `anomaly-freq-${now}`,
      type: 'frequency' as const,
      severity: recentProposals.length > 10 ? 'high' : 'medium' as const,
      message: `Proposal burst detected: ${recentProposals.length} proposals in last ${windowHours}h`,
      timestamp: now,
    }];
  }

  return [];
}

export function detectNewRecipients(
  proposals: { id: string; recipient: string }[],
  historicalRecipients: Set<string>
): Anomaly[] {
  return proposals
    .filter(p => !historicalRecipients.has(p.recipient))
    .map(p => ({
      id: `anomaly-new-recipient-${p.id}`,
      type: 'recipient' as const,
      severity: 'info' as const,
      message: `First-time recipient: ${p.recipient.slice(0, 8)}...`,
      proposalId: p.id,
      timestamp: Date.now(),
    }));
}

export function runFullAnomalyDetection(
  proposals: { id: string; amount: number; timestamp: number; recipient: string }[],
  historicalRecipients: Set<string>
): Anomaly[] {
  return [
    ...detectAmountAnomalies(proposals),
    ...detectFrequencyAnomalies(proposals),
    ...detectNewRecipients(proposals, historicalRecipients),
  ].sort((a, b) => b.timestamp - a.timestamp);
}
