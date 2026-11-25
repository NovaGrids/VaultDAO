/**
 * Proposal relationship graph: batch dependencies and supersession.
 *
 * Rules mirror contracts/vault (see `validate_dependencies`, `plan_batch_order`,
 * `supersede_proposal`):
 *  - a proposal may not depend on itself, and dependency cycles are rejected;
 *  - at most MAX_DEPENDENCIES direct dependencies per proposal;
 *  - dependency chains deeper than MAX_DEPENDENCY_DEPTH are rejected;
 *  - a dependency must be executed before its dependent can run;
 *  - a proposal can be superseded by at most one successor.
 */

export const MAX_DEPENDENCIES = 8;
export const MAX_DEPENDENCY_DEPTH = 16;

export interface GraphProposalInput {
  id: string;
  status: string;
  /** Ids this proposal depends on (contract `depends_on`). */
  dependsOn?: readonly string[];
  /** Id this proposal replaces (contract `supersedes`). */
  supersedes?: string | null;
}

export type EdgeKind = 'dependency' | 'supersession';

export interface GraphEdge {
  /** Dependent / superseding proposal. */
  from: string;
  /** Dependency / superseded proposal. */
  to: string;
  kind: EdgeKind;
}

export type BlockerReason =
  | 'dependency_not_executed'
  | 'dependency_missing'
  | 'too_many_dependencies'
  | 'depth_exceeded'
  | 'supersession_conflict'
  | 'in_cycle';

export interface Blocker {
  proposalId: string;
  reason: BlockerReason;
  /** Related proposal id when there is one. */
  relatedId?: string;
}

export interface ProposalGraph {
  nodes: GraphProposalInput[];
  edges: GraphEdge[];
  /** Strongly connected components that form cycles (size > 1, or a self loop). */
  cycles: string[][];
  blockers: Blocker[];
}

export function buildProposalGraph(proposals: readonly GraphProposalInput[]): ProposalGraph {
  const nodes: GraphProposalInput[] = [];
  const byId = new Map<string, GraphProposalInput>();
  for (const p of proposals) {
    if (byId.has(p.id)) continue;
    byId.set(p.id, p);
    nodes.push(p);
  }

  const edges: GraphEdge[] = [];
  const blockers: Blocker[] = [];

  for (const p of nodes) {
    const deps = [...new Set(p.dependsOn ?? [])];
    if (deps.length > MAX_DEPENDENCIES) blockers.push({ proposalId: p.id, reason: 'too_many_dependencies' });
    for (const dep of deps) {
      edges.push({ from: p.id, to: dep, kind: 'dependency' });
      const target = byId.get(dep);
      if (!target) blockers.push({ proposalId: p.id, reason: 'dependency_missing', relatedId: dep });
      else if (target.status.toLowerCase() !== 'executed') {
        blockers.push({ proposalId: p.id, reason: 'dependency_not_executed', relatedId: dep });
      }
    }
    if (p.supersedes) edges.push({ from: p.id, to: p.supersedes, kind: 'supersession' });
  }

  // A proposal may be superseded by at most one successor.
  const successors = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'supersession') continue;
    successors.set(e.to, [...(successors.get(e.to) ?? []), e.from]);
  }
  for (const [old, list] of successors) {
    if (list.length > 1) {
      for (const id of list) blockers.push({ proposalId: id, reason: 'supersession_conflict', relatedId: old });
    }
  }

  const cycles = findCycles(
    nodes.map(n => n.id),
    edges.filter(e => e.kind === 'dependency' && byId.has(e.to))
  );
  for (const cycle of cycles) {
    for (const id of cycle) blockers.push({ proposalId: id, reason: 'in_cycle' });
  }

  const depths = dependencyDepths(nodes, edges, cycles);
  for (const [id, depth] of depths) {
    if (depth > MAX_DEPENDENCY_DEPTH) blockers.push({ proposalId: id, reason: 'depth_exceeded' });
  }

  return { nodes, edges, cycles, blockers };
}

/**
 * Find dependency cycles with an iterative Tarjan SCC (no recursion, so a
 * 500+ node chain cannot overflow the stack). Output is deterministic: each
 * cycle's ids are sorted and cycles are ordered by their first id.
 */
export function findCycles(ids: readonly string[], edges: readonly Pick<GraphEdge, 'from' | 'to'>[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const e of edges) adjacency.get(e.from)?.push(e.to);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    const work: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const neighbors = adjacency.get(frame.id) ?? [];
      if (frame.next < neighbors.length) {
        const w = neighbors[frame.next++]!;
        if (!adjacency.has(w)) continue;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));

      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.id);
        const selfLoop = component.length === 1 && (adjacency.get(component[0]!) ?? []).includes(component[0]!);
        if (component.length > 1 || selfLoop) cycles.push(component.sort(compareIds));
      }
    }
  }

  return cycles.sort((a, b) => compareIds(a[0]!, b[0]!));
}

/** Numeric-aware id comparison so "p2" < "p10" and plain integers sort numerically. */
export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Longest dependency chain below each node (0 for a node without dependencies). Cycle members share a level. */
function dependencyDepths(
  nodes: readonly GraphProposalInput[],
  edges: readonly GraphEdge[],
  cycles: readonly string[][]
): Map<string, number> {
  const component = new Map<string, string>();
  for (const cycle of cycles) for (const id of cycle) component.set(id, cycle[0]!);
  const rep = (id: string) => component.get(id) ?? id;

  const ids = new Set(nodes.map(n => n.id));
  const deps = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.kind !== 'dependency' || !ids.has(e.to)) continue;
    const from = rep(e.from);
    const to = rep(e.to);
    if (from === to) continue;
    (deps.get(from) ?? deps.set(from, new Set()).get(from)!).add(to);
  }

  // Kahn over the condensed DAG, dependencies first: a node is finished once
  // every dependency below it is, and its depth is 1 + the deepest of them.
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const reps = new Set([...ids].map(rep));
  for (const id of reps) remaining.set(id, deps.get(id)?.size ?? 0);
  for (const [from, set] of deps) {
    for (const to of set) (dependents.get(to) ?? dependents.set(to, []).get(to)!).push(from);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, count] of remaining) {
    if (count === 0) {
      depth.set(id, 0);
      queue.push(id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const done = queue[head]!;
    for (const parent of dependents.get(done) ?? []) {
      depth.set(parent, Math.max(depth.get(parent) ?? 0, depth.get(done)! + 1));
      const left = remaining.get(parent)! - 1;
      remaining.set(parent, left);
      if (left === 0) queue.push(parent);
    }
  }

  const result = new Map<string, number>();
  for (const id of ids) result.set(id, depth.get(rep(id)) ?? 0);
  return result;
}

export interface LayoutOptions {
  columnWidth?: number;
  rowHeight?: number;
  padding?: number;
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  /** 0 = proposals with no dependencies; increases toward dependents. */
  layer: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  width: number;
  height: number;
}

/**
 * Layered layout: a node sits one layer to the right of its deepest dependency;
 * members of a cycle share a layer. Within a layer nodes are ordered by id, so
 * the layout is deterministic for the same input regardless of input order.
 */
export function layoutGraph(graph: ProposalGraph, options: LayoutOptions = {}): GraphLayout {
  const { columnWidth = 180, rowHeight = 64, padding = 24 } = options;
  const depths = dependencyDepths(graph.nodes, graph.edges, graph.cycles);

  const layers = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const layer = depths.get(node.id) ?? 0;
    (layers.get(layer) ?? layers.set(layer, []).get(layer)!).push(node.id);
  }

  const positioned: PositionedNode[] = [];
  let maxRows = 0;
  const layerKeys = [...layers.keys()].sort((a, b) => a - b);
  for (const layer of layerKeys) {
    const ids = layers.get(layer)!.sort(compareIds);
    maxRows = Math.max(maxRows, ids.length);
    ids.forEach((id, row) => {
      positioned.push({ id, layer, x: padding + layer * columnWidth, y: padding + row * rowHeight });
    });
  }

  const columns = layerKeys.length === 0 ? 0 : layerKeys[layerKeys.length - 1]! + 1;
  return {
    nodes: positioned,
    width: padding * 2 + Math.max(0, columns - 1) * columnWidth + 140,
    height: padding * 2 + Math.max(0, maxRows - 1) * rowHeight + 40,
  };
}

/** Plain-language text for each blocker reason. */
export const BLOCKER_LABEL: Record<BlockerReason, string> = {
  dependency_not_executed: 'Waiting for a dependency to execute',
  dependency_missing: 'Depends on a proposal that does not exist',
  too_many_dependencies: `More than ${MAX_DEPENDENCIES} dependencies`,
  depth_exceeded: `Dependency chain deeper than ${MAX_DEPENDENCY_DEPTH}`,
  supersession_conflict: 'Another proposal also supersedes the same proposal',
  in_cycle: 'Part of a circular dependency',
};
