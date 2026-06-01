/**
 * Tests for CommandPalette component.
 *
 * Covers:
 * - Cmd+K / Ctrl+K opens the palette
 * - Escape closes the palette
 * - Click outside (backdrop) closes the palette
 * - Fuzzy search filters actions via fuse.js
 * - Keyboard navigation (ArrowDown / ArrowUp / Enter)
 * - Recently used commands appear at the top
 * - Shortcut is NOT triggered when user is typing in an input
 * - modKey() returns platform-aware label
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandPalette, modKey } from '../CommandPalette';
import type { PaletteAction } from '../CommandPalette';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeActions = (overrides: Partial<PaletteAction>[] = []): PaletteAction[] => [
  {
    id: 'nav-proposals',
    label: 'Go to Proposals',
    description: 'View and manage proposals',
    category: 'navigation',
    action: vi.fn(),
  },
  {
    id: 'nav-analytics',
    label: 'Go to Analytics',
    description: 'Spending analytics',
    category: 'navigation',
    action: vi.fn(),
  },
  {
    id: 'action-new-proposal',
    label: 'New Proposal',
    description: 'Create a new transfer proposal',
    category: 'actions',
    action: vi.fn(),
  },
  {
    id: 'a11y-theme',
    label: 'Switch Theme',
    description: 'Toggle dark/light mode',
    category: 'accessibility',
    action: vi.fn(),
  },
  ...overrides.map((o, i) => ({
    id: `extra-${i}`,
    label: `Extra Action ${i}`,
    category: 'actions' as const,
    action: vi.fn(),
    ...o,
  })),
];

function dispatchKey(key: string, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, bubbles: true, ...opts });
}

// ─── modKey ───────────────────────────────────────────────────────────────────

describe('modKey()', () => {
  it('returns a non-empty string', () => {
    expect(modKey()).toBeTruthy();
    expect(typeof modKey()).toBe('string');
  });
});

// ─── CommandPalette ───────────────────────────────────────────────────────────

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Open / close ────────────────────────────────────────────────────────────

  it('is not visible on initial render', () => {
    render(<CommandPalette actions={makeActions()} />);
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
  });

  it('opens when Ctrl+K is pressed', () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('opens when Meta+K (Cmd+K) is pressed', () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { metaKey: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes when backdrop is clicked', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    // The backdrop is the first fixed div with aria-hidden
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does NOT open when Ctrl+K is pressed inside an input', () => {
    render(
      <>
        <input data-testid="text-input" />
        <CommandPalette actions={makeActions()} />
      </>,
    );
    const input = screen.getByTestId('text-input');
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true, bubbles: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggles closed when Ctrl+K is pressed again while open', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    dispatchKey('k', { ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // ── Search / filtering ──────────────────────────────────────────────────────

  it('shows all actions when query is empty', () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    expect(screen.getByText('Go to Proposals')).toBeInTheDocument();
    expect(screen.getByText('Go to Analytics')).toBeInTheDocument();
    expect(screen.getByText('New Proposal')).toBeInTheDocument();
    expect(screen.getByText('Switch Theme')).toBeInTheDocument();
  });

  it('fuzzy search filters actions by label', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'proposal' } });

    await waitFor(() => {
      expect(screen.getByText('Go to Proposals')).toBeInTheDocument();
      expect(screen.getByText('New Proposal')).toBeInTheDocument();
    });

    // Analytics should not appear for "proposal" query
    expect(screen.queryByText('Go to Analytics')).not.toBeInTheDocument();
  });

  it('shows "No commands found" when query matches nothing', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'xyzzy_no_match_12345' } });

    await waitFor(() => {
      expect(screen.getByText(/no commands found/i)).toBeInTheDocument();
    });
  });

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  it('ArrowDown moves selection down', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    const input = screen.getByRole('combobox');

    // First item should be active (index 0)
    const firstItem = screen.getAllByRole('option')[0];
    expect(firstItem).toHaveAttribute('aria-selected', 'true');

    // Move down
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      const items = screen.getAllByRole('option');
      expect(items[1]).toHaveAttribute('aria-selected', 'true');
      expect(items[0]).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('ArrowUp moves selection up (clamped at 0)', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    const input = screen.getByRole('combobox');

    // Move down first
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    await waitFor(() => {
      const items = screen.getAllByRole('option');
      expect(items[0]).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('Enter executes the active action and closes palette', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);
    dispatchKey('k', { ctrlKey: true });

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // The first action's handler should have been called
    expect(actions[0].action).toHaveBeenCalledTimes(1);
  });

  it('clicking an action executes it and closes palette', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);
    dispatchKey('k', { ctrlKey: true });

    const analyticsItem = screen.getByText('Go to Analytics');
    fireEvent.click(analyticsItem);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(actions[1].action).toHaveBeenCalledTimes(1);
  });

  // ── Recently used ───────────────────────────────────────────────────────────

  it('recently used commands appear at the top when query is empty', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);

    // Execute "Go to Analytics" to mark it as recent
    dispatchKey('k', { ctrlKey: true });
    fireEvent.click(screen.getByText('Go to Analytics'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Re-open palette
    dispatchKey('k', { ctrlKey: true });

    await waitFor(() => {
      const items = screen.getAllByRole('option');
      // "Go to Analytics" should now be first
      expect(items[0]).toHaveTextContent('Go to Analytics');
    });

    // Should show "recent" badge
    expect(screen.getByText('recent')).toBeInTheDocument();
  });

  it('persists recent commands in localStorage', async () => {
    const actions = makeActions();
    render(<CommandPalette actions={actions} />);

    dispatchKey('k', { ctrlKey: true });
    fireEvent.click(screen.getByText('New Proposal'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem('vaultdao_recent_commands') ?? '[]') as string[];
    expect(stored).toContain('action-new-proposal');
  });

  // ── Category grouping ───────────────────────────────────────────────────────

  it('shows category headers when query is empty', () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
  });

  it('hides category headers when query is active', async () => {
    render(<CommandPalette actions={makeActions()} />);
    dispatchKey('k', { ctrlKey: true });

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'proposal' } });

    await waitFor(() => {
      expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
    });
  });

  // ── Shortcut badge ──────────────────────────────────────────────────────────

  it('renders shortcut badge for actions that have a shortcut', () => {
    const actions: PaletteAction[] = [
      {
        id: 'with-shortcut',
        label: 'Action With Shortcut',
        category: 'actions',
        shortcut: 'Ctrl+K',
        action: vi.fn(),
      },
    ];
    render(<CommandPalette actions={actions} />);
    dispatchKey('k', { ctrlKey: true });

    // The shortcut parts should be rendered as kbd elements
    const kbds = screen.getAllByRole('term').concat(
      Array.from(document.querySelectorAll('kbd')),
    );
    expect(kbds.length).toBeGreaterThan(0);
  });
});
