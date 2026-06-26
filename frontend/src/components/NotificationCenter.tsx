import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import {
  Bell, X, Filter, CheckCheck, Trash2, ChevronDown, ChevronRight,
  Layers, Volume2, VolumeX, Settings2, Archive,
} from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import NotificationItem from './NotificationItem';
import type { Notification, NotificationCategory, NotificationPriority, NotificationStatus } from '../types/notification';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'all' | 'proposals' | 'payments' | 'system';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'payments', label: 'Payments' },
  { id: 'system', label: 'System' },
];

const CATEGORY_MAP: Record<TabId, NotificationCategory | null> = {
  all: null, proposals: 'proposals', payments: 'payments', system: 'system',
};

const PRIORITY_ORDER: NotificationPriority[] = ['critical', 'high', 'normal', 'low'];
const PRIORITY_LABELS: Record<NotificationPriority, string> = {
  critical: 'Urgent', high: 'High', normal: 'Normal', low: 'Low',
};
const URGENT_PRIORITIES: NotificationPriority[] = ['critical', 'high'];
const PAGE_SIZE = 20;

function requestBrowserPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendBrowserNotification(title: string, body: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/vite.svg' });
  }
}

function groupNotifications(items: Notification[]): Notification[] {
  const groups = new Map<string, Notification[]>();
  const ungrouped: Notification[] = [];
  for (const n of items) {
    if (n.groupKey) {
      const existing = groups.get(n.groupKey) || [];
      existing.push(n);
      groups.set(n.groupKey, existing);
    } else {
      ungrouped.push(n);
    }
  }
  const result: Notification[] = [...ungrouped];
  for (const [, group] of groups) {
    if (group.length > 1) {
      const sorted = group.sort((a, b) => b.timestamp - a.timestamp);
      result.push({ ...sorted[0], count: group.length });
    } else if (group.length === 1) {
      result.push(group[0]);
    }
  }
  return result.sort((a, b) => b.timestamp - a.timestamp);
}

function playUrgentSound(muted: boolean): void {
  if (muted) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => ctx.close();
  } catch { /* Web Audio not available */ }
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose }) => {
  const {
    notifications, unreadCount, filter, sort,
    markAsRead, markAllAsRead, dismissNotification,
    setFilter, setSort, clearAll, typeSettings, updateTypeSettings,
    archiveAllNormal,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<NotificationCategory[]>(filter.categories);
  const [selectedPriorities, setSelectedPriorities] = useState<NotificationPriority[]>(filter.priorities);
  const [selectedStatus, setSelectedStatus] = useState<NotificationStatus | 'all'>(filter.status || 'all');
  const [grouped, setGrouped] = useState(true);
  const [collapsedPriorities, setCollapsedPriorities] = useState<Set<NotificationPriority>>(
    new Set(['normal', 'low'])
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevIsOpenRef = useRef(isOpen);
  const prevUrgentCountRef = useRef(0);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setSelectedCategories(filter.categories);
      setSelectedPriorities(filter.priorities);
      setSelectedStatus(filter.status || 'all');
      setVisibleCount(PAGE_SIZE);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, filter]);

  useEffect(() => { requestBrowserPermission(); }, []);

  const tabUnreadCounts = useMemo(() => {
    const counts: Record<TabId, number> = { all: unreadCount, proposals: 0, payments: 0, system: 0 };
    for (const n of notifications) {
      if (n.status === 'unread') {
        if (n.category === 'proposals') counts.proposals++;
        else if (n.category === 'payments') counts.payments++;
        else counts.system++;
      }
    }
    return counts;
  }, [notifications, unreadCount]);

  const tabFiltered = useMemo(() => {
    const activeCategory = CATEGORY_MAP[activeTab];
    if (!activeCategory) return notifications;
    return notifications.filter((n) => n.category === activeCategory);
  }, [notifications, activeTab]);

  const filteredNotifications = useMemo(() => {
    let filtered = tabFiltered.filter((n) => {
      const categoryMatch = filter.categories.includes(n.category);
      const priorityMatch = filter.priorities.includes(n.priority);
      const statusMatch = !filter.status || n.status === filter.status;
      const notOptedOut = !typeSettings.disabledCategories.includes(n.category);
      return categoryMatch && priorityMatch && statusMatch && notOptedOut;
    });
    filtered.sort((a, b) => {
      const getPriorityVal = (p: NotificationPriority) => {
        if (p === 'critical') return 0;
        if (p === 'high') return 1;
        return 2;
      };
      const pA = getPriorityVal(a.priority);
      const pB = getPriorityVal(b.priority);
      if (pA !== pB) return pA - pB;
      return sort.order === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
    });
    return grouped ? groupNotifications(filtered) : filtered;
  }, [tabFiltered, filter, sort, grouped, typeSettings.disabledCategories]);

  const notificationsByPriority = useMemo(() => {
    const map = new Map<NotificationPriority, Notification[]>();
    for (const p of PRIORITY_ORDER) map.set(p, []);
    for (const n of filteredNotifications) map.get(n.priority)?.push(n);
    return map;
  }, [filteredNotifications]);

  const flatList = useMemo(() => {
    const urgent = filteredNotifications.filter(n => URGENT_PRIORITIES.includes(n.priority));
    const rest = filteredNotifications.filter(n => !URGENT_PRIORITIES.includes(n.priority));
    return [...urgent, ...rest];
  }, [filteredNotifications]);

  const visibleItems = flatList.slice(0, visibleCount);
  const hasMore = visibleCount < flatList.length;
  const loadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, flatList.length));
  }, [flatList.length]);

  // Play sound for new URGENT notifications
  useEffect(() => {
    const urgentUnread = notifications.filter(
      n => URGENT_PRIORITIES.includes(n.priority) && n.status === 'unread'
    ).length;
    if (urgentUnread > prevUrgentCountRef.current) {
      playUrgentSound(typeSettings.muteSounds);
      const newCritical = notifications
        .filter(n => n.priority === 'critical' && n.status === 'unread')
        .slice(0, 3);
      for (const n of newCritical) sendBrowserNotification(n.title, n.message);
    }
    prevUrgentCountRef.current = urgentUnread;
  }, [notifications, typeSettings.muteSounds]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  const applyFilters = useCallback(() => {
    setFilter({ categories: selectedCategories, priorities: selectedPriorities, status: selectedStatus === 'all' ? undefined : selectedStatus });
    setShowFilters(false);
  }, [selectedCategories, selectedPriorities, selectedStatus, setFilter]);

  const resetFilters = useCallback(() => {
    const all: NotificationCategory[] = ['proposals', 'approvals', 'system', 'payments'];
    const allP: NotificationPriority[] = ['critical', 'high', 'normal', 'low'];
    setSelectedCategories(all); setSelectedPriorities(allP); setSelectedStatus('all');
    setFilter({ categories: all, priorities: allP, status: undefined });
    setShowFilters(false);
  }, [setFilter]);

  const toggleCollapsedPriority = (priority: NotificationPriority) => {
    setCollapsedPriorities(prev => {
      const next = new Set(prev);
      if (next.has(priority)) next.delete(priority); else next.add(priority);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="fixed top-0 right-0 h-full w-full md:w-[480px] bg-gray-900 border-l border-gray-700 z-[101] shadow-2xl flex flex-col" role="dialog" aria-modal="true" aria-labelledby="notification-center-title">

        {/* Header */}
        <div className="flex-shrink-0 bg-gray-800/50 backdrop-blur-md border-b border-gray-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Bell size={24} className="text-purple-400" />
              <h2 id="notification-center-title" className="text-xl font-bold text-white">Notifications</h2>
              {unreadCount > 0 && (
                <span className="bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded-full">{unreadCount}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => updateTypeSettings({ muteSounds: !typeSettings.muteSounds })} className="p-2 hover:bg-gray-700 rounded-lg transition-colors" aria-label={typeSettings.muteSounds ? 'Unmute notification sounds' : 'Mute notification sounds'}>
                {typeSettings.muteSounds ? <VolumeX size={16} className="text-gray-400" /> : <Volume2 size={16} className="text-gray-400" />}
              </button>
              <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-gray-700 rounded-lg transition-colors" aria-label="Notification settings">
                <Settings2 size={16} className="text-gray-400" />
              </button>
              <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors" aria-label="Close notification center">
                <X size={20} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Per-type settings */}
          {showSettings && (
            <div className="mb-3 p-3 bg-gray-800 rounded-lg border border-gray-700 space-y-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Notification Settings</p>
              {(['proposals', 'approvals', 'payments', 'system'] as NotificationCategory[]).map(cat => (
                <label key={cat} className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-300 capitalize">{cat}</span>
                  <input type="checkbox" checked={!typeSettings.disabledCategories.includes(cat)}
                    onChange={(e) => {
                      const disabled = typeSettings.disabledCategories;
                      updateTypeSettings({ disabledCategories: e.target.checked ? disabled.filter(c => c !== cat) : [...disabled, cat] });
                    }}
                    className="w-4 h-4 accent-purple-600" aria-label={`Enable ${cat} notifications`} />
                </label>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-3" role="tablist" aria-label="Notification categories">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count = tabUnreadCounts[tab.id];
              return (
                <button key={tab.id} role="tab" aria-selected={isActive}
                  onClick={() => { setActiveTab(tab.id); setVisibleCount(PAGE_SIZE); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isActive ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {tab.label}
                  {count > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-purple-500' : 'bg-gray-600'}`}>{count > 99 ? '99+' : count}</span>}
                </button>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200 transition-colors" aria-expanded={showFilters}>
              <Filter size={14} /><span>Filter</span>
              <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={() => setGrouped(!grouped)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${grouped ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`} aria-pressed={grouped}>
              <Layers size={14} /><span>Group</span>
            </button>
            <button onClick={markAllAsRead} disabled={unreadCount === 0} className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <CheckCheck size={14} /><span>Mark all read</span>
            </button>
            <button onClick={archiveAllNormal} disabled={notifications.filter(n => n.priority === 'normal' || n.priority === 'low').length === 0} className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Archive size={14} /><span>Archive all normal</span>
            </button>
            <button onClick={clearAll} disabled={notifications.length === 0} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto">
              <Trash2 size={14} /><span>Clear all</span>
            </button>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">Categories</label>
                <div className="flex flex-wrap gap-2">
                  {(['proposals', 'approvals', 'payments', 'system'] as NotificationCategory[]).map(cat => (
                    <button key={cat} onClick={() => setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedCategories.includes(cat) ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                      aria-pressed={selectedCategories.includes(cat)}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">Priorities</label>
                <div className="flex flex-wrap gap-2">
                  {(['critical', 'high', 'normal', 'low'] as NotificationPriority[]).map(pri => (
                    <button key={pri} onClick={() => setSelectedPriorities(prev => prev.includes(pri) ? prev.filter(p => p !== pri) : [...prev, pri])}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedPriorities.includes(pri) ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                      aria-pressed={selectedPriorities.includes(pri)}>
                      {pri.charAt(0).toUpperCase() + pri.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">Status</label>
                <div className="flex gap-2">
                  {(['all', 'unread', 'read'] as const).map(status => (
                    <button key={status} onClick={() => setSelectedStatus(status)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedStatus === status ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                      aria-pressed={selectedStatus === status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">Sort by</label>
                <div className="flex gap-2">
                  {(['timestamp', 'priority'] as const).map(by => (
                    <button key={by} onClick={() => setSort({ by })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sort.by === by ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {by === 'timestamp' ? 'Time' : 'Priority'}
                    </button>
                  ))}
                  <button onClick={() => setSort({ order: sort.order === 'asc' ? 'desc' : 'asc' })}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
                    {sort.order === 'asc' ? '↑ Asc' : '↓ Desc'}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={applyFilters} className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium text-white transition-colors">Apply</button>
                <button onClick={resetFilters} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-300 transition-colors">Reset</button>
              </div>
            </div>
          )}
        </div>

        {/* Notification list — virtualized with InfiniteScroll */}
        <div id="notification-scroll-container" className="flex-1 overflow-y-auto" role="tabpanel" aria-label={`${activeTab} notifications`}>
          {flatList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <Bell size={48} className="text-gray-600 mb-4" />
              <p className="text-gray-400 text-lg font-medium mb-2">No notifications</p>
              <p className="text-gray-500 text-sm">
                {filteredNotifications.length === 0 && notifications.length > 0 ? 'Try adjusting your filters' : "You're all caught up!"}
              </p>
            </div>
          ) : (
            <InfiniteScroll
              dataLength={visibleItems.length}
              next={loadMore}
              hasMore={hasMore}
              loader={<div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>}
              scrollableTarget="notification-scroll-container"
              endMessage={flatList.length > PAGE_SIZE ? <p className="text-center text-xs text-gray-500 py-3">All notifications loaded</p> : null}
            >
              <div className="p-4 space-y-1">
                {PRIORITY_ORDER.map(priority => {
                  const allInPriority = notificationsByPriority.get(priority) ?? [];
                  const visibleInPriority = visibleItems.filter(n => n.priority === priority);
                  if (allInPriority.length === 0) return null;

                  const isUrgent = URGENT_PRIORITIES.includes(priority);
                  const isCollapsed = collapsedPriorities.has(priority);

                  return (
                    <div key={priority} className="mb-3">
                      <button
                        onClick={() => toggleCollapsedPriority(priority)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg mb-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                          isUrgent ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-l-4 border-l-red-500' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
                        }`}
                        aria-expanded={!isCollapsed}
                      >
                        <span className="flex items-center gap-2">
                          {isUrgent && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                          {PRIORITY_LABELS[priority]}
                          <span className="font-normal opacity-70">({allInPriority.length})</span>
                        </span>
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {!isCollapsed && visibleInPriority.length > 0 && (
                        <div className="space-y-2">
                          {visibleInPriority.map(notification => (
                            <NotificationItem
                              key={notification.id}
                              notification={notification}
                              onMarkAsRead={markAsRead}
                              onDismiss={dismissNotification}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </InfiniteScroll>
          )}
        </div>
      </div>
    </>
  );
};

export default NotificationCenter;
