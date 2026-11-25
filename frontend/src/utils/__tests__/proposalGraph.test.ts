import { describe, it, expect } from 'vitest';
import {
  buildProposalGraph,
  findCycles,
  layoutGraph,
  MAX_DEPENDENCIES,
  MAX_DEPENDENCY_DEPTH,
  type GraphProposalInput,
} from '../proposalGraph';

const p = (id: string, status = 'Pending', dependsOn: string[] = [], supersedes: string | null = null): GraphProposalInput => ({
  id,
  status,
  dependsOn,
  supersedes,
});

const reasons = (g: ReturnType<typeof buildProposalGraph>, id: string) =>
  g.blockers.filter(b => b.proposalId === id).map(b => b.reason).sort();

describe('cycle detection (contract fixtures)', () => {
  it('treats a self dependency as a cycle, like validate_dependencies', () => {
    const g = buildProposalGraph([p('1', 'Pending', ['1'])]);
    expect(g.cycles).toEqual([['1']]);
    expect(reasons(g, '1')).toContain('in_cycle');
  });

  it('detects a two-node and a three-node cycle and reports members sorted', () => {
    const g = buildProposalGraph([
      p('3', 'Pending', ['1']),
      p('1', 'Pending', ['2']),
      p('2', 'Pending', ['3']),
      p('10', 'Pending', ['11']),
      p('11', 'Pending', ['10']),
      p('20'),
    ]);
    expect(g.cycles).toEqual([['1', '2', '3'], ['10', '11']]);
    expect(reasons(g, '20')).toEqual([]);
  });

  it('does not flag a diamond (shared dependency) as a cycle', () => {
    const g = buildProposalGraph([p('1'), p('2', 'Pending', ['1']), p('3', 'Pending', ['1']), p('4', 'Pending', ['2', '3'])]);
    expect(g.cycles).toEqual([]);
  });

  it('ignores supersession edges when looking for dependency cycles', () => {
    const g = buildProposalGraph([p('1', 'Pending', [], '2'), p('2', 'Pending', [], '1')]);
    expect(g.cycles).toEqual([]);
  });

  it('handles a 5000-node chain without recursion', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => p(String(i), 'Pending', i > 0 ? [String(i - 1)] : []));
    expect(findCycles(nodes.map(n => n.id), nodes.flatMap(n => (n.dependsOn ?? []).map(to => ({ from: n.id, to }))))).toEqual([]);
  });
});

describe('blockers', () => {
  it('blocks a proposal whose dependency is not executed, but not once it is', () => {
    expect(reasons(buildProposalGraph([p('1', 'Pending'), p('2', 'Pending', ['1'])]), '2')).toEqual(['dependency_not_executed']);
    expect(reasons(buildProposalGraph([p('1', 'Executed'), p('2', 'Pending', ['1'])]), '2')).toEqual([]);
  });

  it('reports a dependency on an unknown proposal', () => {
    const g = buildProposalGraph([p('2', 'Pending', ['99'])]);
    expect(g.blockers).toEqual([{ proposalId: '2', reason: 'dependency_missing', relatedId: '99' }]);
  });

  it('flags more than MAX_DEPENDENCIES direct dependencies', () => {
    const deps = Array.from({ length: MAX_DEPENDENCIES + 1 }, (_, i) => `d${i}`);
    const g = buildProposalGraph([...deps.map(d => p(d, 'Executed')), p('x', 'Pending', deps)]);
    expect(reasons(g, 'x')).toContain('too_many_dependencies');
  });

  it('flags chains deeper than MAX_DEPENDENCY_DEPTH', () => {
    const length = MAX_DEPENDENCY_DEPTH + 2;
    const nodes = Array.from({ length }, (_, i) => p(String(i), 'Executed', i > 0 ? [String(i - 1)] : []));
    const g = buildProposalGraph(nodes);
    expect(reasons(g, String(length - 1))).toContain('depth_exceeded');
    expect(reasons(g, String(MAX_DEPENDENCY_DEPTH - 1))).not.toContain('depth_exceeded');
  });

  it('flags two proposals superseding the same one', () => {
    const g = buildProposalGraph([p('1'), p('2', 'Pending', [], '1'), p('3', 'Pending', [], '1')]);
    expect(reasons(g, '2')).toEqual(['supersession_conflict']);
    expect(reasons(g, '3')).toEqual(['supersession_conflict']);
  });

  it('keeps first occurrence of duplicate ids', () => {
    expect(buildProposalGraph([p('1', 'Executed'), p('1', 'Pending')]).nodes).toHaveLength(1);
  });
});

describe('layoutGraph', () => {
  it('places dependencies left of their dependents', () => {
    const layout = layoutGraph(buildProposalGraph([p('1'), p('2', 'Pending', ['1']), p('3', 'Pending', ['2'])]));
    const x = Object.fromEntries(layout.nodes.map(n => [n.id, n.x]));
    expect(x['1']).toBeLessThan(x['2']!);
    expect(x['2']).toBeLessThan(x['3']!);
  });

  it('is deterministic regardless of input order and numeric-sorts rows', () => {
    const input = [p('10'), p('2'), p('1'), p('3', 'Pending', ['1'])];
    const a = layoutGraph(buildProposalGraph(input));
    const b = layoutGraph(buildProposalGraph([...input].reverse()));
    expect([...a.nodes].sort((l, r) => l.id.localeCompare(r.id))).toEqual([...b.nodes].sort((l, r) => l.id.localeCompare(r.id)));
    const layer0 = a.nodes.filter(n => n.layer === 0).sort((l, r) => l.y - r.y).map(n => n.id);
    expect(layer0).toEqual(['1', '2', '10']);
  });

  it('puts cycle members on one layer and still lays out everything', () => {
    const layout = layoutGraph(buildProposalGraph([p('1', 'Pending', ['2']), p('2', 'Pending', ['1']), p('3', 'Pending', ['1'])]));
    const layer = Object.fromEntries(layout.nodes.map(n => [n.id, n.layer]));
    expect(layer['1']).toBe(layer['2']);
    expect(layer['3']).toBe(layer['1']! + 1);
    expect(layout.nodes).toHaveLength(3);
  });

  it('returns an empty layout for no proposals', () => {
    expect(layoutGraph(buildProposalGraph([]))).toMatchObject({ nodes: [], width: expect.any(Number) });
  });

  it('lays out a 500-node graph within the documented budget', () => {
    const nodes = Array.from({ length: 500 }, (_, i) =>
      p(String(i), i % 3 === 0 ? 'Executed' : 'Pending', i > 0 ? [String(i - 1), String(Math.floor(i / 2))] : [], i > 5 && i % 50 === 0 ? String(i - 5) : null)
    );
    const start = performance.now();
    const graph = buildProposalGraph(nodes);
    const layout = layoutGraph(graph);
    const elapsed = performance.now() - start;
    expect(layout.nodes).toHaveLength(500);
    expect(elapsed).toBeLessThan(250);
  });
});
