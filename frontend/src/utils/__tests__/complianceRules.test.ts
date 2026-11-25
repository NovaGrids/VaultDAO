import { describe, it, expect } from 'vitest';
import {
  evaluateComplianceRules,
  computeComplianceScore,
  parseComplianceConfig,
  MAX_EVIDENCE_PER_RULE,
  type ComplianceRuleConfig,
  type RuleResult,
} from '../complianceRules';
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

const ALL_RULES: ComplianceRuleConfig[] = [
  { kind: 'timelock', id: 'timelock', label: 'Timelock' },
  { kind: 'spending_limit', id: 'cap', label: 'Per-proposal cap', maxAmount: '1000' },
  { kind: 'signer_policy', id: 'signers', label: 'Signer policy', allowedSigners: ['GA', 'GB'], forbidSelfApproval: true },
  { kind: 'breaker', id: 'breaker', label: 'Breaker' },
];

describe('configurable rules', () => {
  it('flags executions above the spending cap with an evidence pointer', () => {
    const entries = [
      event('proposal_ready', T1, { proposal_id: 'p1' }),
      event('proposal_executed', T2, { proposal_id: 'p1', amount: '5000' }),
    ];
    const rule = ruleById(evaluateComplianceRules(entries, ALL_RULES).rules, 'cap');
    expect(rule).toMatchObject({ category: 'spending', evaluated: 1, violations: 1, status: 'review' });
    expect(rule.evidence?.[0]).toMatchObject({ entryId: entries[1]!.id, action: 'proposal_executed' });
    expect(rule.evidence?.[0]?.note).toContain('5000');
  });

  it('does not evaluate the spending rule for events without a usable amount', () => {
    const entries = [event('proposal_executed', T2, { proposal_id: 'p1', amount: 'abc' })];
    expect(ruleById(evaluateComplianceRules(entries, ALL_RULES).rules, 'cap').status).toBe('not_evaluated');
  });

  it('flags approvals from signers outside the allowed set and self approvals', () => {
    const entries = [
      event('proposal_created', T1, { proposal_id: 'p1' }, 'GA'),
      event('proposal_approved', T2, { proposal_id: 'p1' }, 'GA'),
      event('proposal_approved', T2, { proposal_id: 'p1' }, 'GZ'),
      event('proposal_approved', T3, { proposal_id: 'p1' }, 'GB'),
    ];
    const rule = ruleById(evaluateComplianceRules(entries, ALL_RULES).rules, 'signers');
    expect(rule).toMatchObject({ evaluated: 3, violations: 2, status: 'review' });
    expect(rule.evidence?.map(e => e.note)).toEqual([
      'Proposer approved their own proposal p1',
      'Approval by a signer outside the allowed set',
    ]);
  });

  it('flags execution of a token while its breaker is tripped, and clears after reset', () => {
    const entries = [
      event('token_breaker_tripped', T1, { token: 'CUSDC' }),
      event('proposal_executed', T2, { proposal_id: 'p1', token: 'CUSDC' }),
      event('token_breaker_reset', T3, { token: 'CUSDC' }),
      event('proposal_executed', '2026-01-04T00:00:00.000Z', { proposal_id: 'p2', token: 'CUSDC' }),
    ];
    const rule = ruleById(evaluateComplianceRules(entries, ALL_RULES).rules, 'breaker');
    expect(rule).toMatchObject({ evaluated: 2, violations: 1, status: 'review' });
    expect(rule.evidence?.[0]?.entryId).toBe(entries[1]!.id);
  });

  it('evaluates chronologically even when entries arrive newest first', () => {
    const entries = [
      event('proposal_executed', T2, { proposal_id: 'p1', token: 'CUSDC' }),
      event('token_breaker_reset', T3, { token: 'CUSDC' }),
      event('token_breaker_tripped', T1, { token: 'CUSDC' }),
    ];
    expect(ruleById(evaluateComplianceRules(entries, ALL_RULES).rules, 'breaker').violations).toBe(1);
  });

  it('caps evidence but still counts every violation', () => {
    const entries = Array.from({ length: MAX_EVIDENCE_PER_RULE + 5 }, (_, i) =>
      event('proposal_executed', T2, { proposal_id: `p${i}`, amount: '9999' }, `GU${i}`)
    );
    const rule = ruleById(evaluateComplianceRules(entries, ALL_RULES).rules, 'cap');
    expect(rule.violations).toBe(MAX_EVIDENCE_PER_RULE + 5);
    expect(rule.evidence).toHaveLength(MAX_EVIDENCE_PER_RULE);
    expect(rule.evidenceOmitted).toBe(5);
  });
});

describe('score depends only on rule outcomes, not entry counts', () => {
  const compliantRun = [
    event('proposal_ready', T1, { proposal_id: 'p1' }),
    event('proposal_approved', T1, { proposal_id: 'p1' }, 'GA'),
    event('proposal_executed', T2, { proposal_id: 'p1', amount: '10' }),
  ];

  it('is unchanged when more compliant entries are added', () => {
    const more = [...compliantRun];
    for (let i = 2; i < 40; i++) {
      more.push(
        event('proposal_ready', T1, { proposal_id: `p${i}` }, `GR${i}`),
        event('proposal_approved', T1, { proposal_id: `p${i}` }, 'GA'),
        event('proposal_executed', T2, { proposal_id: `p${i}`, amount: '10' }, `GE${i}`)
      );
    }
    expect(evaluateComplianceRules(more, ALL_RULES).score).toBe(evaluateComplianceRules(compliantRun, ALL_RULES).score);
  });

  it('changes when a rule outcome flips', () => {
    const before = evaluateComplianceRules(compliantRun, ALL_RULES).score;
    const after = evaluateComplianceRules(
      [...compliantRun, event('proposal_executed', T3, { proposal_id: 'p9', amount: '99999' }, 'GX')],
      ALL_RULES
    ).score;
    expect(after).not.toBe(before);
  });

  it('is unchanged by unrelated entries that no rule evaluates', () => {
    const noise = Array.from({ length: 50 }, (_, i) => event('vault_note', T1, {}, `GN${i}`));
    expect(evaluateComplianceRules([...compliantRun, ...noise], ALL_RULES).score).toBe(
      evaluateComplianceRules(compliantRun, ALL_RULES).score
    );
  });
});

describe('parseComplianceConfig', () => {
  it('accepts every supported rule kind', () => {
    const result = parseComplianceConfig([
      { kind: 'timelock', id: 't', label: 'T' },
      { kind: 'approval_threshold', id: 'a', label: 'A', defaultThreshold: 2 },
      { kind: 'spending_limit', id: 's', label: 'S', maxAmount: '100' },
      { kind: 'signer_policy', id: 'p', label: 'P', allowedSigners: ['GA'], forbidSelfApproval: true },
      { kind: 'breaker', id: 'b', label: 'B' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects malformed input and reports each problem', () => {
    const result = parseComplianceConfig([
      { kind: 'nope', id: 'x', label: 'X' },
      { kind: 'spending_limit', id: 's', label: 'S', maxAmount: '-5' },
      { kind: 'timelock', id: 'BAD ID', label: 'T' },
      { kind: 'timelock', id: 'dup', label: 'T' },
      { kind: 'breaker', id: 'dup', label: 'B' },
      'string',
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(5);
  });

  it('rejects non-array and oversized configs', () => {
    expect(parseComplianceConfig({}).ok).toBe(false);
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ kind: 'timelock', id: `r${i}`, label: 'R' }));
    expect(parseComplianceConfig(tooMany).ok).toBe(false);
  });
});
