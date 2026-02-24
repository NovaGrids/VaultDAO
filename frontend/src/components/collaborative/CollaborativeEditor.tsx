import React, { useState, useEffect, useCallback } from 'react';
import { Users, Wifi, WifiOff, AlertTriangle, Save, Clock } from 'lucide-react';
import { useCollaboration } from '../../hooks/useCollaboration';
import { useVersionHistory } from '../../hooks/useVersionHistory';
import { useChangeTracking } from '../../hooks/useChangeTracking';
import type { NewProposalFormData } from '../modals/NewProposalModal';

interface CollaborativeEditorProps {
  draftId: string;
  userId: string;
  userName: string;
  initialData: NewProposalFormData;
  onDataChange: (data: NewProposalFormData) => void;
  onSave?: () => void;
}

const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  draftId,
  userId,
  userName,
  initialData,
  onDataChange,
  onSave,
}) => {
  const [formData, setFormData] = useState<NewProposalFormData>(initialData);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { isConnected, collaborators, hasConflict, updateField } = useCollaboration({
    draftId,
    userId,
    userName,
    onSync: (draft) => {
      setFormData(prev => ({
        ...prev,
        recipient: draft.recipient || prev.recipient,
        token: draft.token || prev.token,
        amount: draft.amount || prev.amount,
        memo: draft.memo || prev.memo,
      }));
    },
  });

  const { saveVersion } = useVersionHistory(draftId);
  const { trackChange } = useChangeTracking(draftId);

  // Auto-save every 30 seconds
  useEffect(() => {
    const autoSave = async () => {
      if (!isConnected) return;
      
      setIsSaving(true);
      try {
        saveVersion(formData, userId, userName, 'Auto-save');
        setLastSaved(new Date());
        if (onSave) onSave();
      } catch (error) {
        console.error('Auto-save failed:', error);
      } finally {
        setIsSaving(false);
      }
    };

    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [formData, isConnected, userId, userName, saveVersion, onSave]);

  // Handle field changes
  const handleFieldChange = useCallback((
    field: keyof NewProposalFormData,
    value: string
  ) => {
    const oldValue = formData[field] as string;
    
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      onDataChange(updated);
      return updated;
    });

    // Update CRDT
    if (field !== 'attachments') {
      updateField(field as 'recipient' | 'token' | 'amount' | 'memo', value);
    }

    // Track change
    trackChange(userId, userName, field as any, oldValue, value);
  }, [formData, onDataChange, updateField, trackChange, userId, userName]);

  return (
    <div className="space-y-4">
      {/* Connection Status & Collaborators */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <Wifi size={16} className="text-green-500" />
              <span className="text-sm text-green-400">Connected</span>
            </>
          ) : (
            <>
              <WifiOff size={16} className="text-red-500" />
              <span className="text-sm text-red-400">Disconnected</span>
            </>
          )}
          
          {collaborators.length > 0 && (
            <div className="flex items-center gap-2 ml-4">
              <Users size={16} className="text-gray-400" />
              <div className="flex -space-x-2">
                {collaborators.slice(0, 3).map((collab, idx) => (
                  <div
                    key={idx}
                    className="w-6 h-6 rounded-full border-2 border-gray-800 flex items-center justify-center text-xs font-medium text-white"
                    style={{ backgroundColor: collab.color }}
                    title={collab.userName}
                  >
                    {collab.userName.charAt(0).toUpperCase()}
                  </div>
                ))}
                {collaborators.length > 3 && (
                  <div className="w-6 h-6 rounded-full border-2 border-gray-800 bg-gray-700 flex items-center justify-center text-xs text-gray-300">
                    +{collaborators.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          {isSaving && (
            <div className="flex items-center gap-1">
              <Save size={14} className="animate-pulse" />
              <span>Saving...</span>
            </div>
          )}
          {lastSaved && !isSaving && (
            <div className="flex items-center gap-1">
              <Clock size={14} />
              <span>Saved {formatTimeAgo(lastSaved)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Conflict Warning */}
      {hasConflict && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <AlertTriangle size={16} className="text-yellow-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-yellow-300">
            <p className="font-medium">Potential conflict detected</p>
            <p className="text-xs text-yellow-400 mt-1">
              Another user recently edited this field. Changes are being merged automatically.
            </p>
          </div>
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Recipient Address
          </label>
          <input
            type="text"
            value={formData.recipient}
            onChange={(e) => handleFieldChange('recipient', e.target.value)}
            placeholder="G..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Token
            </label>
            <select
              value={formData.token}
              onChange={(e) => handleFieldChange('token', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
            >
              <option value="NATIVE">XLM (Native)</option>
              <option value="USDC">USDC</option>
              <option value="CUSTOM">Custom Token</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Amount
            </label>
            <input
              type="text"
              value={formData.amount}
              onChange={(e) => handleFieldChange('amount', e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Memo
          </label>
          <textarea
            value={formData.memo}
            onChange={(e) => handleFieldChange('memo', e.target.value)}
            placeholder="Description of the proposal..."
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all resize-none"
          />
        </div>
      </div>
    </div>
  );
};

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default CollaborativeEditor;
