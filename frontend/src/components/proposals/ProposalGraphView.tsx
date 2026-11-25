import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualScroll } from '../../hooks/useVirtualScroll';
import {
  BLOCKER_LABEL,
  buildProposalGraph,
  layoutGraph,
  type GraphProposalInput,
} from '../../utils/proposalGraph';

const NODE_W = 140;
const NODE_H = 40;
const ROW_H = 44;
const DRAWER_H = 280;

interface Props {
  proposals: readonly GraphProposalInput[];
}

/** Link target for a proposal on the existing proposals page. */
export function proposalHref(id: string): string {
  return `/dashboard/proposals?search=${encodeURIComponent(id)}`;
}

/** Non-color status symbols so state is readable without color. */
function statusSymbol(status: string): string {
  switch (status.toLowerCase()) {
    case 'executed':
      return '✓';
    case 'pending':
      return '○';
    case 'approved':
      return '◐';
    default:
      return '×';
  }
}

/**
 * Dependency and supersession graph. Cycles, blockers and status are all
 * encoded with text/symbols and stroke style in addition to color. The detail
 * drawer is windowed so a graph with hundreds of blockers stays cheap.
 */
const ProposalGraphView: React.FC<Props> = ({ proposals }) => {
  const graph = useMemo(() => buildProposalGraph(proposals), [proposals]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const [selected, setSelected] = useState<string | null>(null);

  const position = useMemo(() => new Map(layout.nodes.map(n => [n.id, n])), [layout]);
  const cycleIds = useMemo(() => new Set(graph.cycles.flat()), [graph]);
  const blockedIds = useMemo(() => new Set(graph.blockers.map(b => b.proposalId)), [graph]);
  const statusOf = useMemo(() => new Map(graph.nodes.map(n => [n.id, n.status])), [graph]);

  const rows = useMemo(
    () => (selected ? graph.blockers.filter(b => b.proposalId === selected) : graph.blockers),
    [graph, selected]
  );
  const { handleScroll, range, offscreenStartSize, offscreenEndSize } = useVirtualScroll({
    itemCount: rows.length,
    itemHeight: ROW_H,
    containerHeight: DRAWER_H,
  });

  if (graph.nodes.length === 0) {
    return <p className="text-sm text-gray-400">No proposals to show.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-300">
        {graph.nodes.length} proposals, {graph.edges.length} links, {graph.cycles.length} circular dependenc
        {graph.cycles.length === 1 ? 'y' : 'ies'}, {blockedIds.size} blocked.
      </p>

      <ul className="flex flex-wrap gap-4 text-xs text-gray-300" aria-label="Legend">
        <li>✓ executed</li>
        <li>○ pending</li>
        <li>◐ approved</li>
        <li>× other</li>
        <li>⟳ circular (dashed outline)</li>
        <li>⛔ blocked</li>
        <li>solid arrow: dependency; dotted arrow: supersedes</li>
      </ul>

      <div className="overflow-auto rounded-lg border border-gray-700 max-h-[480px]">
        <svg
          role="group"
          aria-label="Proposal dependency graph"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
        >
          <defs>
            <marker id="pg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {graph.edges.map(edge => {
            const a = position.get(edge.from);
            const b = position.get(edge.to);
            if (!a || !b) return null;
            const inCycle = edge.kind === 'dependency' && cycleIds.has(edge.from) && cycleIds.has(edge.to);
            return (
              <line
                key={`${edge.kind}-${edge.from}-${edge.to}`}
                x1={a.x}
                y1={a.y + NODE_H / 2}
                x2={b.x + NODE_W}
                y2={b.y + NODE_H / 2}
                stroke="currentColor"
                strokeWidth={inCycle ? 2.5 : 1.25}
                strokeDasharray={edge.kind === 'supersession' ? '2 4' : undefined}
                markerEnd="url(#pg-arrow)"
                className={inCycle ? 'text-red-400' : 'text-gray-500'}
              />
            );
          })}
          {layout.nodes.map(node => {
            const status = statusOf.get(node.id) ?? '';
            const inCycle = cycleIds.has(node.id);
            const blocked = blockedIds.has(node.id);
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                <title>{`Proposal ${node.id}: ${status}${inCycle ? ', circular dependency' : ''}${blocked ? ', blocked' : ''}`}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  className={selected === node.id ? 'fill-purple-900' : 'fill-gray-800'}
                  stroke="currentColor"
                  strokeWidth={selected === node.id ? 3 : 1.5}
                  strokeDasharray={inCycle ? '5 3' : undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={`Show blockers for proposal ${node.id}`}
                  aria-pressed={selected === node.id}
                  onClick={() => setSelected(selected === node.id ? null : node.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(selected === node.id ? null : node.id);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                />
                <Link to={proposalHref(node.id)}>
                  <text x={8} y={17} className="fill-white text-[11px] font-semibold">
                    {statusSymbol(status)} #{node.id}
                  </text>
                </Link>
                <text x={8} y={32} className="fill-gray-300 text-[10px]">
                  {status}
                  {inCycle ? ' ⟳' : ''}
                  {blocked ? ' ⛔' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <section aria-label="Blockers" className="rounded-lg border border-gray-700">
        <h3 className="px-3 py-2 text-sm font-semibold border-b border-gray-700">
          {selected ? `Blockers for #${selected}` : 'All blockers'} ({rows.length})
          {selected ? (
            <button type="button" className="ml-3 text-xs underline" onClick={() => setSelected(null)}>
              Show all
            </button>
          ) : null}
        </h3>
        {rows.length === 0 ? (
          <p className="p-3 text-sm text-gray-400">No blockers.</p>
        ) : (
          <div style={{ height: Math.min(DRAWER_H, rows.length * ROW_H), overflowY: 'auto' }} onScroll={handleScroll}>
            <ul style={{ paddingTop: offscreenStartSize, paddingBottom: offscreenEndSize }}>
              {rows.slice(range.startIndex, range.endIndex).map((b, i) => (
                <li
                  key={`${b.proposalId}-${b.reason}-${b.relatedId ?? ''}-${range.startIndex + i}`}
                  style={{ height: ROW_H }}
                  className="px-3 flex items-center text-sm border-b border-gray-800"
                >
                  <span className="mr-2">⛔</span>
                  <Link className="underline mr-2" to={proposalHref(b.proposalId)}>
                    #{b.proposalId}
                  </Link>
                  <span>
                    {BLOCKER_LABEL[b.reason]}
                    {b.relatedId ? ` (#${b.relatedId})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
};

export default ProposalGraphView;
