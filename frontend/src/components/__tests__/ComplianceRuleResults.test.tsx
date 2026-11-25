import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ComplianceRuleResults from '../ComplianceRuleResults';

describe('ComplianceRuleResults', () => {
  it('shows each rule with a text status and its evidence, rendering hostile text inertly', () => {
    const { container } = render(
      <ComplianceRuleResults
        evaluation={{
          score: 50,
          rules: [
            { id: 'a', label: 'Timelock', evaluated: 2, violations: 0, status: 'compliant', evidence: [] },
            {
              id: 'b',
              label: '<img src=x onerror=alert(1)>',
              evaluated: 3,
              violations: 1,
              status: 'review',
              evidence: [
                { entryId: 'e1', sourceEventId: 'ev1', action: 'proposal_executed', timestamp: 't1', note: '<script>x</script>' },
              ],
            },
            { id: 'c', label: 'Breaker', evaluated: 0, violations: 0, status: 'not_evaluated', evidence: [] },
          ],
        }}
      />
    );
    expect(screen.getByText(/COMPLIANT/)).toBeTruthy();
    expect(screen.getByText(/REVIEW/)).toBeTruthy();
    expect(screen.getByText(/NOT EVALUATED/)).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>x</script>');
  });
});
