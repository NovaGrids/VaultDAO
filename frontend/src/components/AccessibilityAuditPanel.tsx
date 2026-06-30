import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, ShieldAlert } from 'lucide-react';
// import axe from 'axe-core';

interface Violation {
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: any[];
}

export function AccessibilityAuditPanel() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [running, setRunning] = useState(false);

  // In a real env, axe-core runs here. 
  const runAudit = async () => {
    setRunning(true);
    try {
      const axe = (await import('axe-core')).default;
      const results = await axe.run(document);
      setViolations(results.violations as Violation[]);
    } catch (e) {
      console.error("Axe core failed to run", e);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      runAudit();
    }
  }, []);

  if (process.env.NODE_ENV !== 'development') {
    return null; // Don't render in production
  }

  const handleFix = (v: Violation) => {
    alert(`Attempting auto-fix for ${v.id}...`);
    // Example: add aria-label if missing
  };

  return (
    <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <ShieldAlert className="text-red-400" />
          Accessibility Audit (Dev Mode)
        </h3>
        <button onClick={runAudit} disabled={running} className="px-3 py-1 bg-gray-700 text-white text-sm rounded">
          {running ? 'Running...' : 'Re-run Audit'}
        </button>
      </div>
      
      {violations.length === 0 ? (
        <p className="text-green-400 text-sm flex items-center gap-1"><Check size={16} /> No violations found!</p>
      ) : (
        <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
          {violations.map((v) => (
            <div key={v.id} className="bg-gray-800 p-4 rounded-lg border border-gray-700">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-white font-bold">{v.help}</h4>
                  <p className="text-sm text-gray-400 mt-1">{v.description}</p>
                  <a href={v.helpUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline mt-2 inline-block">
                    WCAG Criterion
                  </a>
                </div>
                <span className={`px-2 py-1 text-xs font-bold uppercase rounded ${
                  v.impact === 'critical' ? 'bg-red-500/20 text-red-400' :
                  v.impact === 'serious' ? 'bg-orange-500/20 text-orange-400' :
                  v.impact === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-blue-500/20 text-blue-400'
                }`}>
                  {v.impact}
                </span>
              </div>
              <button onClick={() => handleFix(v)} className="mt-3 px-3 py-1 bg-purple-600/50 hover:bg-purple-600 text-white text-xs rounded transition-colors">
                Auto-fix
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AccessibilityAuditPanel;
