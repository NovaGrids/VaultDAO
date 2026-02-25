export interface AuditEntry {
  id: string;
  timestamp: string;
  ledger: string;
  user: string;
  action: string;
  details: Record<string, unknown>;
  transactionHash: string;
  previousHash?: string;
  hash?: string;
}

export function hashEntry(entry: AuditEntry): string {
  const data = `${entry.id}${entry.timestamp}${entry.user}${entry.action}${JSON.stringify(entry.details)}${entry.previousHash || ''}`;
  return simpleHash(data);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

export function verifyAuditChain(entries: AuditEntry[]): {
  isValid: boolean;
  tamperedEntries: string[];
} {
  const tamperedEntries: string[] = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const computedHash = hashEntry(entry);
    
    if (entry.hash && entry.hash !== computedHash) {
      tamperedEntries.push(entry.id);
    }
    
    if (i > 0) {
      const prevEntry = entries[i - 1];
      if (entry.previousHash !== prevEntry.hash) {
        tamperedEntries.push(entry.id);
      }
    }
  }
  
  return {
    isValid: tamperedEntries.length === 0,
    tamperedEntries,
  };
}

export function buildAuditChain(entries: AuditEntry[]): AuditEntry[] {
  return entries.map((entry, index) => {
    const previousHash = index > 0 ? entries[index - 1].hash : undefined;
    const entryWithPrev = { ...entry, previousHash };
    const hash = hashEntry(entryWithPrev);
    return { ...entryWithPrev, hash };
  });
}

export function signAuditData(entries: AuditEntry[]): {
  signature: string;
  timestamp: string;
  algorithm: string;
  entryCount: number;
} {
  const timestamp = new Date().toISOString();
  const dataString = JSON.stringify(entries);
  const combined = `${dataString}${timestamp}`;
  const signature = simpleHash(combined);
  
  return {
    signature,
    timestamp,
    algorithm: 'SHA-256-like',
    entryCount: entries.length,
  };
}
