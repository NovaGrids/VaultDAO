import React from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';

export interface FlowStep {
  label: string;
  status: 'completed' | 'active' | 'pending';
  timestamp?: string;
}

interface SignatureFlowProps {
  steps: FlowStep[];
}

/**
 * SignatureFlow component displays a vertical flow of steps with connector lines.
 * 
 * Visual constraint: The connector lines use absolute positioning with overflow-hidden
 * on the parent to prevent 1-2px overflow artifacts at the bottom. This ensures
 * clean alignment between step icons without bleeding over component boundaries.
 */
const SignatureFlow: React.FC<SignatureFlowProps> = ({ steps }) => {
  return (
    <div className="relative px-2 sm:px-0 overflow-hidden">
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-start gap-2 sm:gap-3 pb-4 sm:pb-6 last:pb-0 relative">
          {/* Connector Line */}
          {idx !== steps.length - 1 && (
            <div className="absolute left-[9px] sm:left-[11px] top-5 sm:top-6 w-0.5 h-full bg-gray-800" />
          )}
          
          {/* Icon */}
          <div className={`relative z-10 shrink-0 ${
            step.status === 'completed' 
              ? 'text-green-500' 
              : step.status === 'active' 
              ? 'text-accent' 
              : 'text-gray-600'
          }`}>
            {step.status === 'completed' ? (
              <CheckCircle2 size={20} className="sm:w-6 sm:h-6 fill-green-500/20" />
            ) : step.status === 'active' ? (
              <Clock size={20} className="sm:w-6 sm:h-6 animate-pulse" />
            ) : (
              <Circle size={20} className="sm:w-6 sm:h-6" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 pt-0.5 min-w-0">
            <div className={`text-xs sm:text-sm font-bold break-words ${
              step.status === 'pending' ? 'text-gray-500' : 'text-white'
            }`}>
              {step.label}
            </div>
            {step.timestamp && (
              <div className="text-[10px] sm:text-xs text-gray-500 mt-1 uppercase tracking-wide break-words">
                {new Date(step.timestamp).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SignatureFlow;
