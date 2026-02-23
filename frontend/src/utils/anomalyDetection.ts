export interface Anomaly {
  id: string;
  type: 'amount' | 'frequency' | 'recipient';
  severity: 'low' | 'medium' | 'high';
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export function detectAmountAnomalies(
  amounts: number[],
  threshold: number = 2
): { isAnomaly: boolean; zScore: number }[] {
  if (amounts.length < 3) return amounts.map(() => ({ isAnomaly: false, zScore: 0 }));
  
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const stdDev = Math.sqrt(
    amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length
  );
  
  if (stdDev === 0) return amounts.map(() => ({ isAnomaly: false, zScore: 0 }));
  
  return amounts.map(amount => {
    const zScore = Math.abs((amount - mean) / stdDev);
    return { isAnomaly: zScore > threshold, zScore };
  });
}

export function detectFrequencyAnomalies(
  timestamps: string[],
  windowHours: number = 24,
  threshold: number = 5
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const now = Date.now();
  
  const recentCount = timestamps.filter(ts => {
    const diff = now - new Date(ts).getTime();
    return diff < windowHours * 60 * 60 * 1000;
  }).length;
  
  if (recentCount > threshold) {
    anomalies.push({
      id: `freq-${Date.now()}`,
      type: 'frequency',
      severity: recentCount > threshold * 2 ? 'high' : 'medium',
      message: `Unusual transaction frequency: ${recentCount} transactions in ${windowHours}h`,
      details: { count: recentCount, window: windowHours },
      timestamp: new Date().toISOString()
    });
  }
  
  return anomalies;
}

export function detectRecipientAnomalies(
  recipients: string[],
  knownRecipients: Set<string>
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const newRecipients = recipients.filter(r => !knownRecipients.has(r));
  
  if (newRecipients.length > 0) {
    anomalies.push({
      id: `recipient-${Date.now()}`,
      type: 'recipient',
      severity: 'low',
      message: `${newRecipients.length} new recipient(s) detected`,
      details: { recipients: newRecipients },
      timestamp: new Date().toISOString()
    });
  }
  
  return anomalies;
}

export function analyzeAnomalies(
  transactions: Array<{ amount: number; timestamp: string; recipient: string }>
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  
  const amounts = transactions.map(t => t.amount);
  const amountResults = detectAmountAnomalies(amounts);
  
  transactions.forEach((tx, i) => {
    if (amountResults[i].isAnomaly) {
      anomalies.push({
        id: `amount-${i}`,
        type: 'amount',
        severity: amountResults[i].zScore > 3 ? 'high' : 'medium',
        message: `Unusual transaction amount: ${tx.amount.toLocaleString()}`,
        details: { amount: tx.amount, zScore: amountResults[i].zScore },
        timestamp: tx.timestamp
      });
    }
  });
  
  const timestamps = transactions.map(t => t.timestamp);
  anomalies.push(...detectFrequencyAnomalies(timestamps));
  
  const knownRecipients = new Set(transactions.slice(0, -5).map(t => t.recipient));
  const recentRecipients = transactions.slice(-5).map(t => t.recipient);
  anomalies.push(...detectRecipientAnomalies(recentRecipients, knownRecipients));
  
  return anomalies.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}
