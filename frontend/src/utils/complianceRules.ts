import type { AuditEntry } from './auditVerification';

/**
 * Compliance rules computed from audit entries.
 *
 * Each rule checks one property against the events that exercise it. A rule
 * with no applicable events is "not_evaluated" rather than compliant, and the
 * score is the share of evaluated rules that pass, or null when none did.
 */

export type RuleStatus = 'compliant' | 'review' | 'not_evaluated';

export interface RuleResult {
  id: string;
  label: string;
  /** Events the rule was checked against */
  evaluated: number;
  /** Evaluated events that break the rule */
  violations: number;
  status: RuleStatus;
}

export interface ComplianceEvaluation {
  rules: RuleResult[];
  /** 0-100 share of evaluated rules that are compliant; null when no rule has data */
  score: number | null;
}

function proposalKey(entry: AuditEntry): string | null {
  const raw = entry.details.proposal_id ?? entry.details.proposalId ?? entry.details.id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
  return null;
}

function timeOf(entry: AuditEntry): number {
  return Date.parse(entry.timestamp);
}

function ruleResult(id: string, label: string, evaluated: number, violations: number): RuleResult {
  const status: RuleStatus = evaluated === 0 ? 'not_evaluated' : violations > 0 ? 'review' : 'compliant';
  return { id, label, evaluated, violations, status };
}

/** Each execution must follow a ready event (timelock elapsed) for the same proposal. */
function timelockRule(entries: AuditEntry[]): RuleResult {
  const readyAt = new Map<string, number>();
  for (const e of entries) {
    if (e.action !== 'proposal_ready') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    const at = timeOf(e);
    const earliest = readyAt.get(key);
    if (earliest === undefined || at < earliest) readyAt.set(key, at);
  }

  let evaluated = 0;
  let violations = 0;
  for (const e of entries) {
    if (e.action !== 'proposal_executed') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    evaluated++;
    const ready = readyAt.get(key);
    if (ready === undefined || ready > timeOf(e)) violations++;
  }
  return ruleResult('timelock', 'Timelock adherence', evaluated, violations);
}

/** Each execution must have distinct approvers at or before it, meeting the threshold in its details (default 1). */
function approvalThresholdRule(entries: AuditEntry[]): RuleResult {
  const approvals = new Map<string, Array<{ approver: string; at: number }>>();
  for (const e of entries) {
    if (e.action !== 'proposal_approved') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    const list = approvals.get(key) ?? [];
    list.push({ approver: e.user, at: timeOf(e) });
    approvals.set(key, list);
  }

  let evaluated = 0;
  let violations = 0;
  for (const e of entries) {
    if (e.action !== 'proposal_executed') continue;
    const key = proposalKey(e);
    if (key === null) continue;
    evaluated++;
    const executedAt = timeOf(e);
    const threshold = Number(e.details.threshold);
    const required = Number.isFinite(threshold) && threshold > 0 ? threshold : 1;
    const approvers = new Set(
      (approvals.get(key) ?? []).filter(a => a.at <= executedAt).map(a => a.approver)
    );
    if (approvers.size < required) violations++;
  }
  return ruleResult('approval_threshold', 'Approval threshold adherence', evaluated, violations);
}

export function computeComplianceScore(rules: RuleResult[]): number | null {
  const evaluatedRules = rules.filter(r => r.status !== 'not_evaluated');
  if (evaluatedRules.length === 0) return null;
  const compliant = evaluatedRules.filter(r => r.status === 'compliant').length;
  return Math.round((compliant / evaluatedRules.length) * 100);
}

export function evaluateComplianceRules(entries: AuditEntry[]): ComplianceEvaluation {
  const rules = [timelockRule(entries), approvalThresholdRule(entries)];
  return { rules, score: computeComplianceScore(rules) };
}

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  compliant: 'COMPLIANT',
  review: 'REVIEW',
  not_evaluated: 'NOT EVALUATED',
};
