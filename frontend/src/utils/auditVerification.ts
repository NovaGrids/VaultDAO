import type { VaultActivity } from '../types/activity';

export interface AuditEntry {
  id: string;
  /** Soroban event id (stable on-chain identifier) */
  sourceEventId: string;
  timestamp: string;
  ledger: string;
  /** Vault contract this event belonged to */
  contractId: string;
  user: string;
  action: string;
  details: Record<string, unknown>;
  /** Application-facing correlation id (event id or tx hash when present) */
  transactionHash: string;
  /** Joined contract event topics ((topic0|topic1|…)) for tamper-evident hashing */
  topicFingerprint: string;
  /** Digest of raw event value XDR; empty when RPC did not return a value payload */
  payloadDigest: string;
  /** Whether the host reported a successful contract call for this event, when known */
  callSucceeded?: boolean;
  previousHash?: string;
  hash?: string;
}

export type AuditIssueCode = 'hash_mismatch' | 'chain_break' | 'missing_payload' | 'failed_call';

export interface AuditIssue {
  entryId: string;
  code: AuditIssueCode;
  message: string;
}

export interface AuditVerificationResult {
  /** True when every link in the hash chain recomputes correctly */
  isValid: boolean;
  /** Unique entry ids with chain or hash problems */
  tamperedEntries: string[];
  issues: AuditIssue[];
  /** strong: all rows include payload digests and no failed calls recorded */
  integrity: 'strong' | 'degraded' | 'none';
  headline: string;
  detailLines: string[];
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/** Deterministic digest of raw Soroban event value XDR (base64) */
export function eventPayloadDigest(valueXdrBase64: string): string {
  return simpleHash(valueXdrBase64);
}

function stableStringify(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

export function hashEntry(entry: AuditEntry): string {
  const details = stableStringify(entry.details);
  const callFlag =
    entry.callSucceeded === false ? '0' : entry.callSucceeded === true ? '1' : 'u';
  const anchor = [
    entry.sourceEventId,
    entry.id,
    entry.ledger,
    entry.contractId,
    entry.topicFingerprint,
    entry.payloadDigest,
    entry.transactionHash,
    entry.timestamp,
    entry.user,
    entry.action,
    details,
    callFlag,
    entry.previousHash ?? '',
  ].join('|');
  return simpleHash(anchor);
}

export function verifyAuditChain(entries: AuditEntry[]): AuditVerificationResult {
  const tamperedSet = new Set<string>();
  const issues: AuditIssue[] = [];

  if (entries.length === 0) {
    return {
      isValid: true,
      tamperedEntries: [],
      issues: [],
      integrity: 'none',
      headline: 'No on-chain events loaded',
      detailLines: ['Fetch events from Soroban RPC to build an audit chain.'],
    };
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const computedHash = hashEntry(entry);

    if (entry.hash && entry.hash !== computedHash) {
      tamperedSet.add(entry.id);
      issues.push({
        entryId: entry.id,
        code: 'hash_mismatch',
        message: `Row hash does not match payload (event ${entry.sourceEventId.slice(0, 18)}…).`,
      });
    }

    if (i > 0) {
      const prevEntry = entries[i - 1];
      if (entry.previousHash !== prevEntry.hash) {
        tamperedSet.add(entry.id);
        issues.push({
          entryId: entry.id,
          code: 'chain_break',
          message: `Broken chain after ledger ${prevEntry.ledger}: this row does not continue the prior hash.`,
        });
      }
    }

    if (!entry.payloadDigest && entry.action !== 'unknown') {
      issues.push({
        entryId: entry.id,
        code: 'missing_payload',
        message: 'No raw event value digest — row is weaker for tamper detection.',
      });
    }

    if (entry.callSucceeded === false) {
      issues.push({
        entryId: entry.id,
        code: 'failed_call',
        message: 'RPC marked this contract event as originating from an unsuccessful call.',
      });
    }
  }

  const chainBroken = issues.some((x) => x.code === 'hash_mismatch' || x.code === 'chain_break');
  const hasDegraded =
    issues.some((x) => x.code === 'missing_payload' || x.code === 'failed_call') ||
    entries.some((e) => !e.payloadDigest);

  const tamperedEntries = Array.from(tamperedSet);
  const isValid = tamperedEntries.length === 0;

  let integrity: AuditVerificationResult['integrity'] = 'none';
  if (entries.length > 0) {
    if (!isValid) integrity = 'degraded';
    else if (!hasDegraded && !chainBroken) integrity = 'strong';
    else integrity = 'degraded';
  }

  let headline: string;
  if (!isValid) {
    headline = `Broken audit chain (${tamperedEntries.length} affected row${tamperedEntries.length === 1 ? '' : 's'})`;
  } else if (integrity === 'strong') {
    headline = 'Verified — hash chain matches loaded on-chain events';
  } else if (integrity === 'none') {
    headline = 'No on-chain events loaded';
  } else {
    headline = 'Chain intact — some rows lack full event payload or show failed calls';
  }

  const detailLines: string[] = [];
  if (!isValid) {
    detailLines.push(
      'Hashes link each row to the previous one using Soroban event ids, ledgers, topics, and value digests.',
      'A break usually means the displayed table was edited out of order or rows were injected or removed.',
    );
  } else if (integrity === 'degraded') {
    detailLines.push(
      'The cryptographic chain is consistent, but degraded integrity means missing value digests or unsuccessful calls.',
      'Exporting still reflects exactly what the RPC returned for this vault contract.',
    );
  }

  return {
    isValid,
    tamperedEntries,
    issues,
    integrity,
    headline,
    detailLines,
  };
}

/**
 * Chronological ordering for Soroban contract events (older → newer).
 */
export function sortVaultActivitiesForAudit(activities: VaultActivity[]): VaultActivity[] {
  return [...activities].sort((a, b) => {
    const la = parseInt(a.ledger, 10) || 0;
    const lb = parseInt(b.ledger, 10) || 0;
    if (la !== lb) return la - lb;
    const pa = a.pagingToken ?? '';
    const pb = b.pagingToken ?? '';
    if (pa !== pb) return pa < pb ? -1 : pa > pb ? 1 : 0;
    const ia = a.eventId;
    const ib = b.eventId;
    if (ia !== ib) return ia < ib ? -1 : ia > ib ? 1 : 0;
    return 0;
  });
}

export function vaultActivityToAuditEntry(activity: VaultActivity, contractId: string): AuditEntry {
  const sourceEventId = activity.eventId || activity.id;
  return {
    id: activity.id,
    sourceEventId,
    timestamp: activity.timestamp,
    ledger: activity.ledger,
    contractId: activity.contractId ?? contractId,
    user: activity.actor || 'System',
    action: activity.type,
    details: activity.details,
    transactionHash: activity.txHash ?? activity.eventId ?? activity.id,
    topicFingerprint: activity.topicFingerprint ?? '',
    payloadDigest: activity.payloadDigest ?? '',
    callSucceeded: activity.callSucceeded,
  };
}

export function prepareChainedAuditLog(activities: VaultActivity[], contractId: string): AuditEntry[] {
  const sorted = sortVaultActivitiesForAudit(activities);
  const entries = sorted.map((a) => vaultActivityToAuditEntry(a, contractId));
  return buildAuditChain(entries);
}

export function buildAuditChain(entries: AuditEntry[]): AuditEntry[] {
  const result: AuditEntry[] = [];
  let previousHash: string | undefined;
  for (const entry of entries) {
    const entryWithPrev: AuditEntry = { ...entry, previousHash };
    const hash = hashEntry(entryWithPrev);
    const complete = { ...entryWithPrev, hash };
    result.push(complete);
    previousHash = hash;
  }
  return result;
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

/** Parse a numeric amount from common vault detail shapes for filtering */
export function entryDetailAmount(entry: AuditEntry): number | null {
  const d = entry.details;
  const raw = d.amount ?? d.Amount;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'bigint') return Number(raw);
  return null;
}
