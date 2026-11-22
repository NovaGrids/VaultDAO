import React, { useState, useMemo } from 'react';
import { AlertTriangle, GitMerge, Check, Eye, EyeOff } from 'lucide-react';

export interface ConflictResolutionPanelProps {
  localData: any;
  remoteData: any;
  baseData?: any;
  onResolve: (data: any) => void;
  onMerge?: (data: any) => void;
}

/**
 * Three-way or two-way merge helper for draft fields.
 */
export function resolveMerge(
  local: Record<string, any> = {},
  remote: Record<string, any> = {},
  base?: Record<string, any>
): Record<string, any> {
  const localObj = local || {};
  const remoteObj = remote || {};
  const baseObj = base || {};

  const allKeys = Array.from(
    new Set([
      ...Object.keys(localObj),
      ...Object.keys(remoteObj),
      ...(base ? Object.keys(baseObj) : []),
    ])
  );

  const merged: Record<string, any> = {};

  for (const key of allKeys) {
    const localVal = localObj[key];
    const remoteVal = remoteObj[key];
    const baseVal = base !== undefined && base !== null ? baseObj[key] : undefined;

    if (base !== undefined && base !== null) {
      // 3-way merge logic
      if (localVal === remoteVal) {
        // Both agree
        merged[key] = localVal;
      } else if (localVal === baseVal) {
        // Only remote changed
        merged[key] = remoteVal;
      } else if (remoteVal === baseVal) {
        // Only local changed
        merged[key] = localVal;
      } else {
        // Both changed concurrently from base (true conflict)
        if (typeof localVal === 'string' && typeof remoteVal === 'string') {
          // If local has a non-empty string, prefer local, otherwise remote
          merged[key] = localVal.trim() ? localVal : remoteVal;
        } else {
          merged[key] = localVal !== undefined ? localVal : remoteVal;
        }
      }
    } else {
      // 2-way merge logic
      if (localVal === remoteVal) {
        merged[key] = localVal;
      } else if (localVal !== undefined && remoteVal === undefined) {
        merged[key] = localVal;
      } else if (remoteVal !== undefined && localVal === undefined) {
        merged[key] = remoteVal;
      } else {
        // Both defined but different: prefer non-empty local if string, else local
        if (typeof localVal === 'string' && typeof remoteVal === 'string') {
          merged[key] = localVal.trim() ? localVal : remoteVal;
        } else {
          merged[key] = localVal !== undefined ? localVal : remoteVal;
        }
      }
    }
  }

  return merged;
}

const ConflictResolutionPanel: React.FC<ConflictResolutionPanelProps> = ({
  localData,
  remoteData,
  baseData,
  onResolve,
  onMerge,
}) => {
  const [showPreview, setShowPreview] = useState(false);

  // Identify fields where local and remote differ
  const conflictingFields = useMemo(() => {
    const localObj = localData || {};
    const remoteObj = remoteData || {};
    const keys = Array.from(new Set([...Object.keys(localObj), ...Object.keys(remoteObj)]));
    return keys.filter((key) => localObj[key] !== remoteObj[key]);
  }, [localData, remoteData]);

  const mergedData = useMemo(() => {
    return resolveMerge(localData, remoteData, baseData);
  }, [localData, remoteData, baseData]);

  const handleAcceptMine = () => {
    onResolve(localData);
  };

  const handleAcceptTheirs = () => {
    onResolve(remoteData);
  };

  const handleMerge = () => {
    if (onMerge) {
      onMerge(mergedData);
    } else {
      onResolve(mergedData);
    }
  };

  return (
    <div
      data-testid="conflict-resolution-panel"
      className="p-4 border border-red-500 bg-red-500/10 rounded-lg shadow-lg space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-red-500" />
          <h3 className="text-red-500 font-bold">Conflict Detected</h3>
        </div>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
          data-testid="toggle-preview-btn"
        >
          {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
          {showPreview ? 'Hide Merged Preview' : 'Preview Merge'}
        </button>
      </div>

      <p className="text-sm text-gray-300">
        Another user edited these fields concurrently. Please choose which version to keep or merge changes.
      </p>

      {/* Conflicting Fields Notice */}
      <div className="text-xs px-3 py-2 bg-gray-900/80 rounded border border-gray-700 text-gray-300">
        {conflictingFields.length > 0 ? (
          <div>
            <span className="font-semibold text-amber-400">Conflicting fields: </span>
            <span>{conflictingFields.join(', ')}</span>
          </div>
        ) : (
          <span className="text-gray-400">No conflicting fields detected.</span>
        )}
      </div>

      {/* Merged Preview (Collapsible) */}
      {showPreview && (
        <div data-testid="merged-preview" className="bg-gray-900 p-3 rounded border border-gray-700">
          <h4 className="text-xs font-semibold text-gray-300 mb-1 flex items-center gap-1">
            <GitMerge size={12} className="text-green-400" /> Merged Result Preview
          </h4>
          <pre className="text-xs text-green-300 overflow-y-auto max-h-32">
            {JSON.stringify(mergedData, null, 2)}
          </pre>
        </div>
      )}

      {/* Diff Panels */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Local / Mine */}
        <div className="flex-1 bg-gray-800 p-4 rounded-lg border border-gray-700 flex flex-col justify-between">
          <div>
            <h4 className="font-semibold text-gray-300 mb-2">Your Changes</h4>
            <div className="text-xs text-gray-400 bg-gray-900 p-3 rounded h-32 overflow-y-auto mb-3">
              <pre>{JSON.stringify(localData, null, 2)}</pre>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAcceptMine}
            data-testid="accept-mine-btn"
            title="Keep Mine"
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 transition-colors text-white rounded font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none flex items-center justify-center gap-1.5"
          >
            <Check size={16} />
            Accept Mine
          </button>
        </div>

        {/* Remote / Theirs */}
        <div className="flex-1 bg-gray-800 p-4 rounded-lg border border-gray-700 flex flex-col justify-between">
          <div>
            <h4 className="font-semibold text-gray-300 mb-2">Their Changes</h4>
            <div className="text-xs text-gray-400 bg-gray-900 p-3 rounded h-32 overflow-y-auto mb-3">
              <pre>{JSON.stringify(remoteData, null, 2)}</pre>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAcceptTheirs}
            data-testid="accept-theirs-btn"
            title="Keep Theirs"
            className="w-full py-2 bg-purple-600 hover:bg-purple-700 transition-colors text-white rounded font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none flex items-center justify-center gap-1.5"
          >
            <Check size={16} />
            Accept Theirs
          </button>
        </div>
      </div>

      {/* Merge Action Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleMerge}
          data-testid="merge-btn"
          title="Merge Changes"
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 transition-colors text-white rounded-lg font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none flex items-center justify-center gap-2 shadow"
        >
          <GitMerge size={16} />
          Merge Changes
        </button>
      </div>
    </div>
  );
};

export default ConflictResolutionPanel;
