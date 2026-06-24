import React, { useState } from 'react';
import { CheckCircle2, Clock, XCircle, RotateCcw, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

export type PhaseStatus = 'Pending' | 'Executed' | 'RolledBack' | 'Failed';

export interface ProposalPhase {
  id: string;
  label: string;
  status: PhaseStatus;
  summary: string;
  rollbackOp?: string;
}

interface ProposalPhaseTimelineProps {
  phases: ProposalPhase[];
  isExecuting?: boolean;
}

const STATUS_CONFIG: Record<PhaseStatus, { icon: React.ReactNode; color: string; badge: string }> = {
  Pending:    { icon: <Clock className="w-4 h-4" />,        color: 'text-yellow-400', badge: 'bg-yellow-400/10 text-yellow-300 border border-yellow-500/30' },
  Executed:   { icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300 border border-emerald-500/30' },
  RolledBack: { icon: <RotateCcw className="w-4 h-4" />,    color: 'text-blue-400',   badge: 'bg-blue-400/10 text-blue-300 border border-blue-500/30' },
  Failed:     { icon: <XCircle className="w-4 h-4" />,      color: 'text-red-400',   badge: 'bg-red-400/10 text-red-300 border border-red-500/30' },
};

const PhaseStep: React.FC<{ phase: ProposalPhase; isLast: boolean; isExecuting: boolean }> = ({
  phase, isLast, isExecuting,
}) => {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[phase.status];

  return (
    <li role="listitem" className="relative flex gap-3">
      {/* Connector line */}
      {!isLast && (
        <span className="absolute left-[14px] top-8 h-full w-px bg-white/10" aria-hidden="true" />
      )}

      {/* Status icon */}
      <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 ${cfg.color}`}>
        {isExecuting && phase.status === 'Pending' ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-label="Executing" />
        ) : cfg.icon}
      </span>

      {/* Content */}
      <div className="flex-1 pb-6 min-w-0">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded"
        >
          <span className="text-sm font-medium text-white truncate">{phase.label}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badge}`}>
              {cfg.icon}
              {phase.status}
            </span>
            {expanded
              ? <ChevronDown className="w-4 h-4 text-white/40" />
              : <ChevronRight className="w-4 h-4 text-white/40" />}
          </div>
        </button>

        {/* Mobile badge */}
        <span className={`sm:hidden mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badge}`}>
          {cfg.icon}{phase.status}
        </span>

        {expanded && (
          <div className="mt-2 space-y-1 text-xs text-white/60">
            <p>{phase.summary}</p>
            {phase.rollbackOp && (
              <p className="text-blue-300/70">
                <span className="font-medium text-blue-300">Rollback: </span>
                {phase.rollbackOp}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

const ProposalPhaseTimeline: React.FC<ProposalPhaseTimelineProps> = ({ phases, isExecuting = false }) => {
  if (!phases.length) {
    return (
      <p className="text-sm text-white/40 italic py-2">No execution phases defined for this proposal.</p>
    );
  }

  return (
    <ul aria-label="Proposal execution phases" className="space-y-0">
      {phases.map((phase, idx) => (
        <PhaseStep
          key={phase.id}
          phase={phase}
          isLast={idx === phases.length - 1}
          isExecuting={isExecuting}
        />
      ))}
    </ul>
  );
};

export default ProposalPhaseTimeline;
