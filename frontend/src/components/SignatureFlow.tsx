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

const SignatureFlow: React.FC<SignatureFlowProps> = ({ steps }) => {
  return (
    <div className="relative">
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-start gap-3 pb-6 last:pb-0 relative">
          {/* Connector Line */}
          {idx !== steps.length - 1 && (
            <div className="absolute left-[11px] top-6 w-0.5 h-full bg-gray-800" />
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
              <CheckCircle2 size={24} className="fill-green-500/20" />
            ) : step.status === 'active' ? (
              <Clock size={24} className="animate-pulse" />
            ) : (
              <Circle size={24} />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 pt-0.5">
            <div className={`text-sm font-bold ${
              step.status === 'pending' ? 'text-gray-500' : 'text-white'
            }`}>
              {step.label}
            </div>
            {step.timestamp && (
              <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">
                {new Date(step.timestamp).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SignatureFlow;
