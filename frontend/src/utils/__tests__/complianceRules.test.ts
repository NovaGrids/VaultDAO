import { describe, it, expect } from 'vitest';
import { evaluateComplianceRules, computeComplianceScore, type RuleResult } from '../complianceRules';
import type { AuditEntry } from '../auditVerification';

function event(
  action: string,
  timestamp: string,
  details: Record<string, unknown> = {},
  user = 'GAPPROVER1'
): AuditEntry {
  return {
    id: `${action}-${timestamp}-${user}`,
    sourceEventId: '',
    timestamp,
    ledger: '1',
    contractId: 'CVAULT',
    user,
    action,
    details,
    transactionHash: '',
    topicFingerprint: '',
    payloadDigest: '',
  } as AuditEntry;
}

function ruleById(rules: RuleResult[], id: string): RuleResult {
  const rule = rules.find(r => r.id === id);
  if (!rule) throw new Error(`missing rule ${id}`);
  return rule;
}

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

describe('evaluateComplianceRules', () => {
  it('reports every rule as not evaluated and the score as null when there are no entries', () => {
    const { rules, score } = evaluateComplianceRules([]);

    expect(rules.every(r => r.status === 'not_evaluated')).toBe(true);
    expect(score).toBeNull();
  });

  it('marks an execution after its ready event as timelock compliant', () => {
    const entries = [
      event('proposal_ready', T1, { proposal_id: 'p1' }),
      event('proposal_executed', T2, { proposal_id: 'p1' }),
    ];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'timelock');

    expect(rule).toMatchObject({ evaluated: 1, violations: 0, status: 'compliant' });
  });

  it('flags an execution with no ready event as a timelock violation', () => {
    const entries = [event('proposal_executed', T2, { proposal_id: 'p1' })];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'timelock');

    expect(rule).toMatchObject({ evaluated: 1, violations: 1, status: 'review' });
  });

  it('flags an execution that happened before its ready event', () => {
    const entries = [
      event('proposal_executed', T1, { proposal_id: 'p1' }),
      event('proposal_ready', T2, { proposal_id: 'p1' }),
    ];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'timelock');

    expect(rule.status).toBe('review');
  });

  it('does not evaluate executions that carry no proposal identifier', () => {
    const entries = [event('proposal_executed', T2, {})];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'timelock');

    expect(rule.status).toBe('not_evaluated');
  });

  it('uses the default threshold of one approver when the execution has none', () => {
    const entries = [
      event('proposal_approved', T1, { proposal_id: 'p1' }, 'GA'),
      event('proposal_executed', T2, { proposal_id: 'p1' }),
    ];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'approval_threshold');

    expect(rule).toMatchObject({ evaluated: 1, violations: 0, status: 'compliant' });
  });

  it('counts distinct approvers against the threshold recorded on the execution', () => {
    const entries = [
      event('proposal_approved', T1, { proposal_id: 'p1' }, 'GA'),
      event('proposal_approved', T1, { proposal_id: 'p1' }, 'GA'),
      event('proposal_executed', T2, { proposal_id: 'p1', threshold: 2 }),
    ];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'approval_threshold');

    expect(rule).toMatchObject({ violations: 1, status: 'review' });
  });

  it('ignores approvals recorded after the execution', () => {
    const entries = [
      event('proposal_executed', T1, { proposal_id: 'p1' }),
      event('proposal_approved', T2, { proposal_id: 'p1' }, 'GA'),
    ];
    const rule = ruleById(evaluateComplianceRules(entries).rules, 'approval_threshold');

    expect(rule.status).toBe('review');
  });

  it('scores the share of evaluated rules that are compliant', () => {
    const entries = [
      event('proposal_ready', T1, { proposal_id: 'p1' }),
      event('proposal_approved', T1, { proposal_id: 'p1' }, 'GA'),
      event('proposal_executed', T2, { proposal_id: 'p1' }),
      event('proposal_executed', T3, { proposal_id: 'p2' }),
    ];
    const { rules, score } = evaluateComplianceRules(entries);

    expect(ruleById(rules, 'timelock').status).toBe('review');
    expect(ruleById(rules, 'approval_threshold').status).toBe('review');
    expect(score).toBe(0);
  });

  it('scores 100 when every evaluated rule passes', () => {
    const entries = [
      event('proposal_ready', T1, { proposal_id: 'p1' }),
      event('proposal_approved', T1, { proposal_id: 'p1' }, 'GA'),
      event('proposal_executed', T2, { proposal_id: 'p1' }),
    ];
    const { rules, score } = evaluateComplianceRules(entries);

    expect(ruleById(rules, 'timelock').status).toBe('compliant');
    expect(ruleById(rules, 'approval_threshold').status).toBe('compliant');
    expect(score).toBe(100);
  });
});

describe('computeComplianceScore', () => {
  const rule = (status: RuleResult['status']): RuleResult => ({
    id: status,
    label: status,
    evaluated: status === 'not_evaluated' ? 0 : 1,
    violations: status === 'review' ? 1 : 0,
    status,
  });

  it('rounds the compliant share to a whole percentage', () => {
    expect(computeComplianceScore([rule('compliant'), rule('compliant'), rule('review')])).toBe(67);
  });

  it('returns null when every rule is not evaluated', () => {
    expect(computeComplianceScore([rule('not_evaluated')])).toBeNull();
  });
});
