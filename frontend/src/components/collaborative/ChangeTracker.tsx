import React, { useState, useMemo } from 'react';
import { Activity, User, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { useChangeTracking } from '../../hooks/useChangeTracking';

interface ChangeTrackerProps {
  draftId: string;
}

const ChangeTracker: React.FC<ChangeTrackerProps> = ({ draftId }) => {
  const { changes, getChangesByUser, getChangesByField } = useChangeTracking(draftId);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [filterField, setFilterField] = useState<string>('all');
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());

  // Get unique users and fields
  const uniqueUsers = useMemo(() => {
    const users = new Map<string, string>();
    changes.forEach(change => {
      users.set(change.userId, change.userName);
    });
    return Array.from(users.entries());
  }, [changes]);

  const uniqueFields = useMemo(() => {
    return Array.from(new Set(changes.map(c => c.field)));
  }, [changes]);

  // Filter changes
  const filteredChanges = useMemo(() => {
    let filtered = changes;
    
    if (filterUser !== 'all') {
      filtered = getChangesByUser(filterUser);
    }
    
    if (filterField !== 'all') {
      filtered = filtered.filter(c => c.field === filterField);
    }
    
    return filtered;
  }, [changes, filterUser, filterField, getChangesByUser]);

  // Group changes by user
  const changesByUser = useMemo(() => {
    const grouped = new Map<string, typeof changes>();
    filteredChanges.forEach(change => {
      const existing = grouped.get(change.userId) || [];
      grouped.set(change.userId, [...existing, change]);
    });
    return grouped;
  }, [filteredChanges]);

  const toggleExpand = (changeId: string) => {
    setExpandedChanges(prev => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  };

  if (changes.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <Activity size={48} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">No changes tracked yet</p>
        <p className="text-xs mt-1">Changes will appear here as users edit</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Filter by User
          </label>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500 outline-none"
          >
            <option value="all">All Users ({changes.length})</option>
            {uniqueUsers.map(([userId, userName]) => (
              <option key={userId} value={userId}>
                {userName} ({getChangesByUser(userId).length})
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Filter by Field
          </label>
          <select
            value={filterField}
            onChange={(e) => setFilterField(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500 outline-none"
          >
            <option value="all">All Fields</option>
            {uniqueFields.map(field => (
              <option key={field} value={field}>
                {field.charAt(0).toUpperCase() + field.slice(1)} ({getChangesByField(field).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Changes by User */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Activity size={16} />
          Change History ({filteredChanges.length})
        </h4>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {Array.from(changesByUser.entries()).map(([userId, userChanges]) => {
            const userName = userChanges[0]?.userName || 'Unknown';
            const userColor = generateUserColor(userId);

            return (
              <div key={userId} className="space-y-2">
                {/* User Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                    style={{ backgroundColor: userColor }}
                  >
                    {userName.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-300">{userName}</span>
                  <span className="text-xs text-gray-500">
                    ({userChanges.length} {userChanges.length === 1 ? 'change' : 'changes'})
                  </span>
                </div>

                {/* User Changes */}
                <div className="space-y-1 pl-8">
                  {userChanges.map((change) => {
                    const isExpanded = expandedChanges.has(change.id);
                    const hasLongValue = change.oldValue.length > 50 || change.newValue.length > 50;

                    return (
                      <div
                        key={change.id}
                        className="p-2 rounded bg-gray-800/30 border border-gray-700/50 hover:border-gray-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-purple-400 capitalize">
                                {change.field}
                              </span>
                              <span className="text-xs text-gray-500">
                                {new Date(change.timestamp).toLocaleString()}
                              </span>
                            </div>

                            {!isExpanded && hasLongValue ? (
                              <p className="text-xs text-gray-400 truncate">
                                Changed from "{change.oldValue.slice(0, 30)}..." to "{change.newValue.slice(0, 30)}..."
                              </p>
                            ) : (
                              <div className="text-xs space-y-1">
                                <div className="flex items-start gap-2">
                                  <span className="text-red-400 flex-shrink-0">-</span>
                                  <span className="text-red-300/80 break-all">{change.oldValue || '(empty)'}</span>
                                </div>
                                <div className="flex items-start gap-2">
                                  <span className="text-green-400 flex-shrink-0">+</span>
                                  <span className="text-green-300/80 break-all">{change.newValue || '(empty)'}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {hasLongValue && (
                            <button
                              onClick={() => toggleExpand(change.id)}
                              className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex-shrink-0"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function generateUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
  ];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export default ChangeTracker;
