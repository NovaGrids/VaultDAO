import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProposalGraphView, { proposalHref } from '../ProposalGraphView';
import { toGraphInput } from '../../../app/dashboard/ProposalGraph';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ProposalGraphView', () => {
  it('shows a cycle and blockers with text, not only color', () => {
    const { container } = wrap(
      <ProposalGraphView
        proposals={[
          { id: '1', status: 'Pending', dependsOn: ['2'] },
          { id: '2', status: 'Pending', dependsOn: ['1'] },
          { id: '3', status: 'Executed' },
        ]}
      />
    );
    expect(screen.getByText(/1 circular dependency/)).toBeTruthy();
    expect(container.textContent).toContain('⟳');
    expect(container.textContent).toContain('Part of a circular dependency');
    expect(container.textContent).toContain('✓ #3');
    expect(container.querySelectorAll('rect[stroke-dasharray]').length).toBe(2);
  });

  it('filters blockers when a node is selected and links into the proposals page', () => {
    wrap(
      <ProposalGraphView
        proposals={[
          { id: '1', status: 'Pending', dependsOn: ['9'] },
          { id: '2', status: 'Pending', dependsOn: ['1'] },
        ]}
      />
    );
    expect(screen.getByText(/All blockers \(2\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show blockers for proposal 2' }));
    expect(screen.getByText(/Blockers for #2 \(1\)/)).toBeTruthy();
    expect(screen.getAllByRole('link').some(a => a.getAttribute('href') === proposalHref('2'))).toBe(true);
  });

  it('renders only a window of rows for a large blocker list', () => {
    const proposals = Array.from({ length: 500 }, (_, i) => ({ id: String(i), status: 'Pending', dependsOn: [`m${i}`] }));
    const { container } = wrap(<ProposalGraphView proposals={proposals} />);
    expect(container.querySelectorAll('section[aria-label="Blockers"] li').length).toBeLessThan(30);
  });

  it('renders hostile ids as text', () => {
    const { container } = wrap(<ProposalGraphView proposals={[{ id: '<img src=x onerror=alert(1)>', status: 'Pending' }]} />);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('toGraphInput', () => {
  it('reads optional relationship fields and tolerates their absence', () => {
    expect(toGraphInput({ id: 4, status: 'Pending' })).toEqual({ id: '4', status: 'Pending', dependsOn: [], supersedes: null });
    expect(toGraphInput({ id: '5', status: 'Executed', depends_on: [1, 2], supersedes: 3 })).toEqual({
      id: '5',
      status: 'Executed',
      dependsOn: ['1', '2'],
      supersedes: '3',
    });
    expect(toGraphInput(null)).toBeNull();
  });
});
