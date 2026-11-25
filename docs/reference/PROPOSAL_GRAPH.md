# Proposal Graph

`/dashboard/proposals/graph` shows batch dependencies and supersession between proposals, linking each node to the existing proposals page (`/dashboard/proposals?search=<id>`).

## Contract rules mirrored

Implemented in `frontend/src/utils/proposalGraph.ts`, tested against fixtures modelled on `contracts/vault` (`validate_dependencies`, `plan_batch_order`, `supersede_proposal`):

| Rule | Contract | Graph blocker |
| --- | --- | --- |
| No self dependency / dependency cycles | `CircularDependency` | `in_cycle` (cycle members get a dashed outline and ⟳) |
| At most 8 direct dependencies | max 8 | `too_many_dependencies` |
| Dependency chain depth at most 16 | `MAX_DEP_DEPTH` | `depth_exceeded` |
| Dependencies must be executed first | `DependencyNotMet` | `dependency_not_executed` |
| Dependency must exist | `ProposalNotFound` | `dependency_missing` |
| One successor per superseded proposal | `SupersessionConflict` | `supersession_conflict` |

Cycles are found with an iterative Tarjan SCC, so deep chains cannot overflow the stack.

## Accessibility

Status is never conveyed by color alone: every node shows a symbol and the status text (✓ executed, ○ pending, ◐ approved, × other), cycles use a dashed outline plus ⟳, blockers show ⛔, and supersession edges are dotted while dependency edges are solid. Nodes are keyboard focusable buttons that filter the blocker list.

## Performance budget (500 nodes)

| Stage | Budget | Notes |
| --- | --- | --- |
| Build + cycle detection + layout | < 250 ms | asserted in `proposalGraph.test.ts` |
| SVG render | one `<g>` per node, one `<line>` per edge (about 1,000 elements for 500 nodes with 2 deps each) | rendered inside a scroll container |
| Blocker drawer | only visible rows plus overscan are mounted | windowed with `useVirtualScroll` |
| Load | graph component is lazy loaded on its route | not in the main bundle |

Beyond roughly 2,000 nodes switch to canvas rendering or paginate by connected component.

## Data source

Proposal records need `dependsOn` (or `depends_on`) and `supersedes` to draw relationships. The current proposals hook does not populate them yet, so until it does the page shows nodes without edges. `toGraphInput` already reads those fields when present.
