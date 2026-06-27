/**
 * CommandPalette — Cmd+K / Ctrl+K command palette for VaultDAO.
 *
 * Features:
 * - Triggered by Cmd+K (Mac) or Ctrl+K (Windows/Linux)
 * - Fuzzy search over all registered actions via fuse.js
 * - Recently used commands float to the top
 * - Closes on Escape or click outside
 * - Respects focus: disabled when user is typing in an input
 * - Platform-aware key display (⌘ on Mac, Ctrl elsewhere)
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import Fuse from 'fuse.js';
import { Search, Command, ArrowRight } from 'lucide-react';
import { useVaultContract } from '../hooks/useVaultContract';
import { useProposals } from '../hooks/useProposals';
import { useToast } from '../hooks/useToast';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavigationCommand {
  id: string;
  label: string;
  description?: string;
  category: 'navigation' | 'accessibility';
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export interface ActionCommand {
  id: string;
  label: string;
  description?: string;
  category: 'actions';
  actionType?: 'approve' | 'reject' | 'create-payment' | 'view-audit';
  proposalId?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export type PaletteAction = NavigationCommand | ActionCommand;

interface CommandPaletteProps {
  actions: PaletteAction[];
  /** Maximum number of recently-used commands to remember */
  maxRecent?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_KEY = 'vaultdao_recent_commands';
const MAX_RECENT_DEFAULT = 10;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** Platform-aware modifier key label */
export function modKey(): string {
  return isMac ? '⌘' : 'Ctrl';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ actions, maxRecent = MAX_RECENT_DEFAULT }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>(loadRecent);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { proposals } = useProposals();
  const { approveProposal, rejectProposal } = useVaultContract();
  const toast = useToast();
  const showToast = toast?.showToast || (toast as any)?.notify;

  const [confirmation, setConfirmation] = useState<{
    type: 'approve' | 'reject';
    proposalId: string;
    memo?: string;
    amount?: string;
  } | null>(null);
  const [executing, setExecuting] = useState(false);

  const handleConfirmAction = async () => {
    if (!confirmation) return;
    setExecuting(true);
    try {
      if (confirmation.type === 'approve') {
        await approveProposal(parseInt(confirmation.proposalId, 10) || 0);
        showToast?.('Proposal approved successfully', 'success');
      } else {
        await rejectProposal(parseInt(confirmation.proposalId, 10) || 0);
        showToast?.('Proposal rejected successfully', 'success');
      }
      setConfirmation(null);
      close();
    } catch (e) {
      console.error(e);
      showToast?.(e instanceof Error ? e.message : 'Action failed', 'error');
    } finally {
      setExecuting(false);
    }
  };

  // ── Filtered + sorted results ─────────────────────────────────────────────

  const results = useMemo<PaletteAction[]>(() => {
    const queryLower = query.trim().toLowerCase();
    
    // Autocomplete proposal actions
    if (queryLower.startsWith('approve:') || queryLower.startsWith('reject:')) {
      const isApprove = queryLower.startsWith('approve:');
      const searchId = queryLower.split(':')[1]?.trim() || '';
      
      const activeProposals = proposals.filter(p => p.status === 'Pending' || p.status === 'active');
      const filteredProposals = searchId 
        ? activeProposals.filter(p => p.id.toString().includes(searchId) || p.memo?.toLowerCase().includes(searchId))
        : activeProposals;
        
      return filteredProposals.map(p => ({
        id: `${isApprove ? 'approve' : 'reject'}-${p.id}`,
        label: `${isApprove ? 'Approve' : 'Reject'} Proposal #${p.id}`,
        description: `Recipient: ${p.recipient} | Amount: ${p.amount} XLM | Memo: ${p.memo}`,
        category: 'actions' as const,
        actionType: isApprove ? ('approve' as const) : ('reject' as const),
        proposalId: p.id.toString(),
        action: () => {
          setConfirmation({
            type: isApprove ? 'approve' : 'reject',
            proposalId: p.id.toString(),
            memo: p.memo,
            amount: p.amount
          });
        }
      }));
    }

    const defaultActions = [...actions];

    const approveHelper: PaletteAction = {
      id: 'action-approve-trigger',
      label: 'approve:',
      description: 'Approve a proposal by ID (autocomplete)',
      category: 'actions' as const,
      actionType: 'approve',
      action: () => {
        setQuery('approve:');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    
    const rejectHelper: PaletteAction = {
      id: 'action-reject-trigger',
      label: 'reject:',
      description: 'Reject a proposal by ID (autocomplete)',
      category: 'actions' as const,
      actionType: 'reject',
      action: () => {
        setQuery('reject:');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };

    const allActions = [approveHelper, rejectHelper, ...defaultActions];

    if (!query.trim()) {
      const recentActions = recentIds
        .map((id) => allActions.find((a) => a.id === id))
        .filter((a): a is PaletteAction => Boolean(a));
      const rest = allActions.filter((a) => !recentIds.includes(a.id));
      const combined = [...recentActions, ...rest];
      const categoriesOrder = ['navigation', 'actions', 'accessibility'] as const;
      const sorted: PaletteAction[] = [];
      for (const cat of categoriesOrder) {
        sorted.push(...combined.filter(a => a.category === cat));
      }
      return sorted;
    }
    
    const fuseInstance = new Fuse(allActions, {
      keys: ['label', 'description', 'category'],
      threshold: 0.4,
      includeScore: true,
    });
    return fuseInstance.search(query).map((r) => r.item);
  }, [query, actions, recentIds, proposals]);

  // ── Open / close ──────────────────────────────────────────────────────────

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  // ── Global keyboard listener ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K — open palette (skip if typing in an input)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        setIsOpen((prev) => !prev);
        setQuery('');
        setActiveIndex(0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Focus input when opened ───────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // ── Keyboard navigation inside palette ───────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = results[activeIndex];
        if (item) executeAction(item);
      }
    },
    [results, activeIndex, close], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Scroll active item into view ──────────────────────────────────────────

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  // ── Execute action ────────────────────────────────────────────────────────

  const executeAction = useCallback(
    (item: PaletteAction) => {
      setRecentIds((prev) => {
        const next = [item.id, ...prev.filter((id) => id !== item.id)].slice(0, maxRecent);
        saveRecent(next);
        return next;
      });
      if (item.id === 'action-approve-trigger' || item.id === 'action-reject-trigger') {
        item.action();
        return;
      }
      close();
      item.action();
    },
    [close, maxRecent],
  );

  // ── Reset active index when results change ────────────────────────────────

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  if (!isOpen && !confirmation) return null;

  const categoryLabels: Record<PaletteAction['category'], string> = {
    navigation: 'Navigation',
    actions: 'Actions',
    accessibility: 'Accessibility',
  };

  // Group results by category only when there's no query
  const showGrouped = !query.trim();

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          aria-hidden="true"
          onClick={close}
        />
      )}

      {/* Palette */}
      {isOpen && (
        <div
          className="fixed inset-x-0 top-[15%] z-50 mx-auto w-full max-w-xl px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-gray-700 px-4 py-3">
            <Search className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search commands…"
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
              aria-label="Search commands"
              aria-autocomplete="list"
              aria-controls="command-palette-list"
              aria-activedescendant={
                results[activeIndex] ? `cmd-item-${results[activeIndex].id}` : undefined
              }
              role="combobox"
              aria-expanded={results.length > 0}
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <ul
            id="command-palette-list"
            ref={listRef}
            role="listbox"
            aria-label="Command results"
            className="max-h-80 overflow-y-auto py-2"
          >
            {results.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-gray-500">
                No commands found for &ldquo;{query}&rdquo;
              </li>
            )}

            {showGrouped
              ? (['navigation', 'actions', 'accessibility'] as const).map((cat) => {
                  const group = results.filter((r) => r.category === cat);
                  if (group.length === 0) return null;
                  const globalOffset = results.indexOf(group[0]);
                  return (
                    <li key={cat} role="presentation">
                      <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {categoryLabels[cat]}
                      </p>
                      <ul role="group" aria-label={categoryLabels[cat]}>
                        {group.map((item, idx) => {
                          const globalIdx = globalOffset + idx;
                          return (
                            <PaletteItem
                              key={item.id}
                              item={item}
                              isActive={globalIdx === activeIndex}
                              isRecent={recentIds.includes(item.id) && !query.trim()}
                              onSelect={() => executeAction(item)}
                              onHover={() => setActiveIndex(globalIdx)}
                            />
                          );
                        })}
                      </ul>
                    </li>
                  );
                })
              : results.map((item, idx) => (
                  <PaletteItem
                    key={item.id}
                    item={item}
                    isActive={idx === activeIndex}
                    isRecent={false}
                    onSelect={() => executeAction(item)}
                    onHover={() => setActiveIndex(idx)}
                  />
                ))}
          </ul>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-700 px-4 py-2">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5">↵</kbd>
                select
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Command className="h-3 w-3" aria-hidden />
              <span>{modKey()}+K</span>
            </div>
          </div>
        </div>
      </div>
    )}

      {confirmation && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl text-white" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title">
            <h3 id="confirm-action-title" className="text-lg font-bold mb-2 capitalize text-red-400">
              Confirm {confirmation.type} action
            </h3>
            <p className="text-sm text-gray-300 mb-4">
              Are you sure you want to {confirmation.type} proposal #{confirmation.proposalId}?
              {confirmation.memo && <span className="block mt-2 text-xs text-gray-400">Memo: {confirmation.memo}</span>}
              {confirmation.amount && <span className="block text-xs text-gray-400">Amount: {confirmation.amount} XLM</span>}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmation(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={executing}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors text-white ${
                  confirmation.type === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {executing ? 'Executing...' : 'Confirm & Sign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── PaletteItem ──────────────────────────────────────────────────────────────

interface PaletteItemProps {
  item: PaletteAction;
  isActive: boolean;
  isRecent: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function PaletteItem({ item, isActive, isRecent, onSelect, onHover }: PaletteItemProps) {
  return (
    <li
      id={`cmd-item-${item.id}`}
      role="option"
      aria-selected={isActive}
      className={[
        'flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 transition-colors',
        isActive ? 'bg-purple-600/20 text-white' : 'text-gray-300 hover:bg-gray-800',
      ].join(' ')}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <div className="flex items-center gap-3 min-w-0">
        {item.icon && (
          <span className="shrink-0 text-gray-400" aria-hidden>
            {item.icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{item.label}</span>
            {isRecent && (
              <span className="shrink-0 rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                recent
              </span>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-gray-500 truncate">{item.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {item.shortcut && (
          <ShortcutBadge shortcut={item.shortcut} />
        )}
        <ArrowRight
          className={`h-4 w-4 transition-opacity ${isActive ? 'opacity-100 text-purple-400' : 'opacity-0'}`}
          aria-hidden
        />
      </div>
    </li>
  );
}

// ─── ShortcutBadge ────────────────────────────────────────────────────────────

function ShortcutBadge({ shortcut }: { shortcut: string }) {
  // Replace "Cmd" / "Ctrl" with platform-aware symbol
  const display = shortcut
    .replace(/\bCmd\b/g, isMac ? '⌘' : 'Ctrl')
    .replace(/\bCtrl\b/g, isMac ? '⌘' : 'Ctrl');

  const parts = display.split('+');

  return (
    <div className="flex items-center gap-0.5">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <kbd className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
            {part}
          </kbd>
          {i < parts.length - 1 && (
            <span className="text-gray-600 text-xs">+</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default CommandPalette;
