import type { AuditEntry } from './auditVerification';

/**
 * Compliance rules computed from audit entries.
 *
 * Each rule checks one property against the events that exercise it. A rule
 * with no applicable events is "not_evaluated" rather than compliant, and the
 * score is the share of evaluated rules that pass, or null when none did.
 */

export type RuleStatus = 'compliant' | 'review' | 'not_evaluated';

export type RuleCategory = 'timelock' | 'signer' | 'spending' | 'breaker';

/** Points a reviewer at the audit entry that proves an outcome. */
export interface EvidencePointer {
  entryId: string;
  sourceEventId: string;
  action: string;
  timestamp: string;
  /** Plain-text reason this entry violates (or satisfies) the rule. Never HTML. */
  note: string;
}

export interface RuleResult {
  id: string;
  label: string;
  category?: RuleCategory;
  /** Events the rule was checked against */
  evaluated: number;
  /** Evaluated events that break the rule */
  violations: number;
  status: RuleStatus;
  /** Entries that broke the rule, capped at MAX_EVIDENCE_PER_RULE */
  evidence?: EvidencePointer[];
  /** Violations beyond the evidence cap */
  evidenceOmitted?: number;
}

export interface ComplianceEvaluation {
  rules: RuleResult[];
  /** 0-100 share of evaluated rules that are compliant; null when no rule has data */
  score: number | null;
}

/**
 * Rule configuration (the DSL). Each entry is plain JSON so operators can keep
 * it in config. Unknown kinds or malformed values are rejected by
 * parseComplianceConfig rather than silently ignored.
 */
export type ComplianceRuleConfig =
  | { kind: 'timelock'; id: string; label: string }
  | { kind: 'approval_threshold'; id: string; label: string; defaultThreshold?: number }
  /** Executed amounts (base units, digits only) must not exceed maxAmount per proposal. */
  | { kind: 'spending_limit'; id: string; label: string; maxAmount: string }
  /** Approvers must be in allowedSigners (when given) and must not be the proposer when forbidSelfApproval. */
  | { kind: 'signer_policy'; id: string; label: string; allowedSigners?: string[]; forbidSelfApproval?: boolean }
  /** No execution of a token while its circuit breaker is tripped. */
  | { kind: 'breaker'; id: string; label: string };

export const MAX_EVIDENCE_PER_RULE = 20;
export const MAX_RULES = 50;
export const MAX_ALLOWED_SIGNERS = 200;

export const DEFAULT_COMPLIANCE_RULES: readonly ComplianceRuleConfig[] = [
  { kind: 'timelock', id: 'timelock', label: 'Timelock adherence' },
  { kind: 'approval_threshold', id: 'approval_threshold', label: 'Approval threshold adherence' },
];

function proposalKey(entry: AuditEntry): string | null {
  const raw = entry.details.proposal_id ?? entry.details.proposalId ?? entry.details.id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
  return null;
}

function timeOf(entry: AuditEntry): number {
  return Date.parse(entry.timestamp);
}

function evidenceFor(entry: AuditEntry, note: string): EvidencePointer {
  return {
    entryId: entry.id,
    sourceEventId: entry.sourceEventId,
    action: entry.action,
    timestamp: entry.timestamp,
    note,
  };
}

interface Tally {
  evaluated: number;
  violations: number;
  evidence: EvidencePointer[];
}

function newTally(): Tally {
  return { evaluated: 0, violations: 0, evidence: [] };
}

function violation(tally: Tally, entry: AuditEntry, note: string): void {
  tally.violations++;
  if (tally.evidence.length < MAX_EVIDENCE_PER_RULE) tally.evidence.push(evidenceFor(entry, note));
}

function ruleResult(config: ComplianceRuleConfig, category: RuleCategory, tally: Tally): RuleResult {
  const { evaluated, violations } = tally;
  const status: RuleStatus = evaluated === 0 ? 'not_evaluated' : violations > 0 ? 'review' : 'compliant';
  return {
    id: config.id,
    label: config.label,
    category,
    evaluated,
    violations,
    status,
    evidence: tally.evidence,
    evidenceOmitted: Math.max(0, violations - tally.evidence.length),
  };
}

function toBigInt(raw: unknown): bigint | null {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw === 'string' && /^\d{1,40}$/.test(raw)) return BigInt(raw);
  return null;
}

/** Each execution must follow a ready event (timelock elapsed) for the same proposal. */
function timelockRule(config: ComplianceRuleConfig, entries: AuditEntry[]): RuleResult {
  const readyAt = new Map<string, number>();
  for (const e of entries) {
    if (e.action !== 'proposal_ready') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    const at = timeOf(e);
    const earliest = readyAt.get(key);
    if (earliest === undefined || at < earliest) readyAt.set(key, at);
  }

  const tally = newTally();
  for (const e of entries) {
    if (e.action !== 'proposal_executed') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    tally.evaluated++;
    const ready = readyAt.get(key);
    if (ready === undefined) violation(tally, e, `Proposal ${key} executed with no ready event`);
    else if (ready > timeOf(e)) violation(tally, e, `Proposal ${key} executed before its ready event`);
  }
  return ruleResult(config, 'timelock', tally);
}

/** Each execution must have distinct approvers at or before it, meeting the threshold in its details. */
function approvalThresholdRule(
  config: Extract<ComplianceRuleConfig, { kind: 'approval_threshold' }>,
  entries: AuditEntry[]
): RuleResult {
  const approvals = new Map<string, Array<{ approver: string; at: number }>>();
  for (const e of entries) {
    if (e.action !== 'proposal_approved') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    const list = approvals.get(key) ?? [];
    list.push({ approver: e.user, at: timeOf(e) });
    approvals.set(key, list);
  }

  const fallback = config.defaultThreshold !== undefined && config.defaultThreshold > 0 ? config.defaultThreshold : 1;
  const tally = newTally();
  for (const e of entries) {
    if (e.action !== 'proposal_executed') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    tally.evaluated++;
    const executedAt = timeOf(e);
    const threshold = Number(e.details.threshold);
    const required = Number.isFinite(threshold) && threshold > 0 ? threshold : fallback;
    const approvers = new Set(
      (approvals.get(key) ?? []).filter(a => a.at <= executedAt).map(a => a.approver)
    );
    if (approvers.size < required) {
      violation(tally, e, `Proposal ${key} executed with ${approvers.size} distinct approvals, ${required} required`);
    }
  }
  return ruleResult(config, 'signer', tally);
}

function spendingLimitRule(
  config: Extract<ComplianceRuleConfig, { kind: 'spending_limit' }>,
  entries: AuditEntry[]
): RuleResult {
  const max = BigInt(config.maxAmount);
  const tally = newTally();
  for (const e of entries) {
    if (e.action !== 'proposal_executed') continue;
    const amount = toBigInt(e.details.amount);
    if (amount === null) continue; // no usable amount: cannot evaluate this event
    tally.evaluated++;
    if (amount > max) {
      violation(tally, e, `Executed amount ${amount} exceeds the limit of ${max}`);
    }
  }
  return ruleResult(config, 'spending', tally);
}

function signerPolicyRule(
  config: Extract<ComplianceRuleConfig, { kind: 'signer_policy' }>,
  entries: AuditEntry[]
): RuleResult {
  const allowed = config.allowedSigners ? new Set(config.allowedSigners) : null;
  const proposers = new Map<string, string>();
  for (const e of entries) {
    if (e.action !== 'proposal_created') continue;
    const key = proposalKey(e);
    if (key !== null) proposers.set(key, e.user);
  }

  const tally = newTally();
  for (const e of entries) {
    if (e.action !== 'proposal_approved') continue;
    tally.evaluated++;
    const key = proposalKey(e);
    if (allowed && !allowed.has(e.user)) {
      violation(tally, e, 'Approval by a signer outside the allowed set');
    } else if (config.forbidSelfApproval && key !== null && proposers.get(key) === e.user) {
      violation(tally, e, `Proposer approved their own proposal ${key}`);
    }
  }
  return ruleResult(config, 'signer', tally);
}

function breakerRule(config: ComplianceRuleConfig, entries: AuditEntry[]): RuleResult {
  const tripped = new Set<string>();
  const tally = newTally();
  for (const e of entries) {
    const token = typeof e.details.token === 'string' ? e.details.token : null;
    if (token === null) continue;
    if (e.action === 'token_breaker_tripped') tripped.add(token);
    else if (e.action === 'token_breaker_reset') tripped.delete(token);
    else if (e.action === 'proposal_executed') {
      tally.evaluated++;
      if (tripped.has(token)) violation(tally, e, 'Executed while the token circuit breaker was tripped');
    }
  }
  return ruleResult(config, 'breaker', tally);
}

export function computeComplianceScore(rules: RuleResult[]): number | null {
  const evaluatedRules = rules.filter(r => r.status !== 'not_evaluated');
  if (evaluatedRules.length === 0) return null;
  const compliant = evaluatedRules.filter(r => r.status === 'compliant').length;
  return Math.round((compliant / evaluatedRules.length) * 100);
}

/**
 * Evaluate the configured rules against audit entries. The score depends only
 * on rule outcomes, so adding entries that do not change a rule's status
 * leaves it unchanged.
 */
export function evaluateComplianceRules(
  entries: AuditEntry[],
  configs: readonly ComplianceRuleConfig[] = DEFAULT_COMPLIANCE_RULES
): ComplianceEvaluation {
  // Chronological order; ties keep input order (Array.prototype.sort is stable).
  const ordered = [...entries].sort((a, b) => timeOf(a) - timeOf(b));
  const rules = configs.map(config => {
    switch (config.kind) {
      case 'timelock':
        return timelockRule(config, ordered);
      case 'approval_threshold':
        return approvalThresholdRule(config, ordered);
      case 'spending_limit':
        return spendingLimitRule(config, ordered);
      case 'signer_policy':
        return signerPolicyRule(config, ordered);
      case 'breaker':
        return breakerRule(config, ordered);
    }
  });
  return { rules, score: computeComplianceScore(rules) };
}

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  compliant: 'COMPLIANT',
  review: 'REVIEW',
  not_evaluated: 'NOT EVALUATED',
};

export type ParseComplianceConfigResult =
  | { ok: true; configs: ComplianceRuleConfig[] }
  | { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** Validate untrusted JSON into rule configs. Returns every error found. */
export function parseComplianceConfig(input: unknown): ParseComplianceConfigResult {
  if (!Array.isArray(input)) return { ok: false, errors: ['Config must be an array of rules'] };
  if (input.length > MAX_RULES) return { ok: false, errors: [`At most ${MAX_RULES} rules are allowed`] };

  const errors: string[] = [];
  const configs: ComplianceRuleConfig[] = [];
  const seen = new Set<string>();

  input.forEach((raw, i) => {
    const at = `rules[${i}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) {
      errors.push(`${at}: id must match ${ID_PATTERN}`);
      return;
    }
    if (seen.has(r.id)) {
      errors.push(`${at}: duplicate id "${r.id}"`);
      return;
    }
    if (typeof r.label !== 'string' || r.label.length === 0 || r.label.length > 120) {
      errors.push(`${at}: label must be 1-120 characters`);
      return;
    }
    const base = { id: r.id, label: r.label };
    switch (r.kind) {
      case 'timelock':
      case 'breaker':
        configs.push({ kind: r.kind, ...base });
        break;
      case 'approval_threshold': {
        const t = r.defaultThreshold;
        if (t !== undefined && !(typeof t === 'number' && Number.isInteger(t) && t > 0)) {
          errors.push(`${at}: defaultThreshold must be a positive integer`);
          return;
        }
        configs.push({ kind: 'approval_threshold', ...base, ...(t !== undefined ? { defaultThreshold: t } : {}) });
        break;
      }
      case 'spending_limit':
        if (typeof r.maxAmount !== 'string' || !/^\d{1,40}$/.test(r.maxAmount)) {
          errors.push(`${at}: maxAmount must be a digits-only string`);
          return;
        }
        configs.push({ kind: 'spending_limit', ...base, maxAmount: r.maxAmount });
        break;
      case 'signer_policy': {
        const s = r.allowedSigners;
        if (
          s !== undefined &&
          !(Array.isArray(s) && s.length <= MAX_ALLOWED_SIGNERS && s.every(x => typeof x === 'string' && x.length > 0 && x.length <= 128))
        ) {
          errors.push(`${at}: allowedSigners must be an array of up to ${MAX_ALLOWED_SIGNERS} strings`);
          return;
        }
        if (r.forbidSelfApproval !== undefined && typeof r.forbidSelfApproval !== 'boolean') {
          errors.push(`${at}: forbidSelfApproval must be a boolean`);
          return;
        }
        configs.push({
          kind: 'signer_policy',
          ...base,
          ...(s !== undefined ? { allowedSigners: s as string[] } : {}),
          ...(r.forbidSelfApproval !== undefined ? { forbidSelfApproval: r.forbidSelfApproval as boolean } : {}),
        });
        break;
      }
      default:
        errors.push(`${at}: unknown kind`);
        return;
    }
    seen.add(r.id);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, configs };
}
