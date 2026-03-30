/**
 * Tests for NotificationCenter component
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest with @testing-library/react.
 */

import type { Notification } from '../../types/notification';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

const mockNotifications: Notification[] = [
  {
    id: '1',
    category: 'proposals',
    priority: 'high',
    status: 'unread',
    title: 'New Proposal',
    message: 'A new proposal has been submitted',
    timestamp: Date.now() - 3600000,
    actions: [
      { id: 'view', label: 'View', type: 'view' },
      { id: 'dismiss', label: 'Dismiss', type: 'dismiss' },
    ],
  },
  {
    id: '2',
    category: 'approvals',
    priority: 'critical',
    status: 'unread',
    title: 'Approval Required',
    message: 'Your approval is needed for transaction',
    timestamp: Date.now() - 7200000,
  },
  {
    id: '3',
    category: 'system',
    priority: 'normal',
    status: 'read',
    title: 'System Update',
    message: 'System has been updated',
    timestamp: Date.now() - 86400000,
  },
];

describe('NotificationCenter', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  const renderWithProvider = (isOpen = true, onClose = vi.fn()) => {
    return render(
      <NotificationProvider>
        <NotificationCenter isOpen={isOpen} onClose={onClose} />
      </NotificationProvider>
    );
  };

  it('renders when open', () => {
    renderWithProvider(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderWithProvider(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderWithProvider(true, onClose);
    
    const closeButton = screen.getByLabelText('Close notification center');
    fireEvent.click(closeButton);
    
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderWithProvider(true, onClose);
    
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/60');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithProvider(true, onClose);
    
    fireEvent.keyDown(document, { key: 'Escape' });
    
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays empty state when no notifications', () => {
    renderWithProvider(true);
    expect(screen.getByText('No notifications')).toBeInTheDocument();
    expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
  });

  it('toggles filter panel', () => {
    renderWithProvider(true);
    
    const filterButton = screen.getByText('Filter');
    expect(screen.queryByRole('region', { name: 'Notification filters' })).not.toBeInTheDocument();
    
    fireEvent.click(filterButton);
    expect(screen.getByRole('region', { name: 'Notification filters' })).toBeInTheDocument();
    
    fireEvent.click(filterButton);
    expect(screen.queryByRole('region', { name: 'Notification filters' })).not.toBeInTheDocument();
  });

  it('has accessible ARIA attributes', () => {
    renderWithProvider(true);
    
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'notification-center-title');
  });

  it('disables mark all read button when no unread notifications', () => {
    renderWithProvider(true);
    
    const markAllButton = screen.getByLabelText('Mark all as read');
    expect(markAllButton).toBeDisabled();
  });

  it('disables clear all button when no notifications', () => {
    renderWithProvider(true);
    
    const clearAllButton = screen.getByLabelText('Clear all notifications');
    expect(clearAllButton).toBeDisabled();
  });

  describe('Filter Sync on Panel Open', () => {
    it('syncs local filter state when panel opens', () => {
      const { rerender } = render(
        <NotificationProvider>
          <NotificationCenter isOpen={false} onClose={vi.fn()} />
        </NotificationProvider>
      );

      // Panel is closed, now open it
      rerender(
        <NotificationProvider>
          <NotificationCenter isOpen={true} onClose={vi.fn()} />
        </NotificationProvider>
      );

      // Open filter panel
      const filterButton = screen.getByText('Filter');
      fireEvent.click(filterButton);

      // Verify all default filters are selected
      const proposalsButton = screen.getByRole('button', { name: /Proposals/i, pressed: true });
      const approvalsButton = screen.getByRole('button', { name: /Approvals/i, pressed: true });
      const systemButton = screen.getByRole('button', { name: /System/i, pressed: true });
      
      expect(proposalsButton).toHaveClass('bg-purple-600');
      expect(approvalsButton).toHaveClass('bg-purple-600');
      expect(systemButton).toHaveClass('bg-purple-600');
    });

    it('reflects external filter reset when panel reopens', async () => {
      const TestComponent = () => {
        const [isOpen, setIsOpen] = React.useState(true);
        const { resetFilters } = useNotifications();

        return (
          <>
            <button onClick={() => setIsOpen(false)}>Close Panel</button>
            <button onClick={() => setIsOpen(true)}>Open Panel</button>
            <button onClick={resetFilters}>Reset Filters Externally</button>
            <NotificationCenter isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </>
        );
      };

      render(
        <NotificationProvider>
          <TestComponent />
        </NotificationProvider>
      );

      // Open filter panel and modify filters
      const filterButton = screen.getByText('Filter');
      fireEvent.click(filterButton);

      // Deselect a category
      const proposalsButton = screen.getByRole('button', { name: /Proposals/i });
      fireEvent.click(proposalsButton);

      // Apply filters
      const applyButton = screen.getByText('Apply Filters');
      fireEvent.click(applyButton);

      // Close the panel
      const closePanelButton = screen.getByText('Close Panel');
      fireEvent.click(closePanelButton);

      // Reset filters externally while panel is closed
      const resetExternalButton = screen.getByText('Reset Filters Externally');
      fireEvent.click(resetExternalButton);

      // Reopen the panel
      const openPanelButton = screen.getByText('Open Panel');
      fireEvent.click(openPanelButton);

      // Open filter panel again
      fireEvent.click(filterButton);

      // Verify proposals is selected again (reset worked)
      const proposalsButtonAfter = screen.getByRole('button', { name: /Proposals/i });
      expect(proposalsButtonAfter).toHaveClass('bg-purple-600');
    });

    it('does not sync when panel is already open', () => {
      const { rerender } = render(
        <NotificationProvider>
          <NotificationCenter isOpen={true} onClose={vi.fn()} />
        </NotificationProvider>
      );

      // Open filter panel
      const filterButton = screen.getByText('Filter');
      fireEvent.click(filterButton);

      // Deselect a category
      const proposalsButton = screen.getByRole('button', { name: /Proposals/i });
      fireEvent.click(proposalsButton);
      
      // Verify it's deselected
      expect(proposalsButton).not.toHaveClass('bg-purple-600');

      // Rerender with panel still open (should not reset local state)
      rerender(
        <NotificationProvider>
          <NotificationCenter isOpen={true} onClose={vi.fn()} />
        </NotificationProvider>
      );

      // Verify proposals is still deselected (no sync occurred)
      const proposalsButtonAfter = screen.getByRole('button', { name: /Proposals/i });
      expect(proposalsButtonAfter).not.toHaveClass('bg-purple-600');
    });

    it('syncs all filter types (categories, priorities, status)', () => {
      const TestComponent = () => {
        const [isOpen, setIsOpen] = React.useState(false);
        const { setFilter } = useNotifications();

        const setCustomFilter = () => {
          setFilter({
            categories: ['proposals'],
            priorities: ['high', 'critical'],
            status: 'unread',
          });
        };

        return (
          <>
            <button onClick={setCustomFilter}>Set Custom Filter</button>
            <button onClick={() => setIsOpen(true)}>Open Panel</button>
            <NotificationCenter isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </>
        );
      };

      render(
        <NotificationProvider>
          <TestComponent />
        </NotificationProvider>
      );

      // Set custom filter while panel is closed
      const setFilterButton = screen.getByText('Set Custom Filter');
      fireEvent.click(setFilterButton);

      // Open panel
      const openButton = screen.getByText('Open Panel');
      fireEvent.click(openButton);

      // Open filter panel
      const filterButton = screen.getByText('Filter');
      fireEvent.click(filterButton);

      // Verify only proposals is selected
      const proposalsButton = screen.getByRole('button', { name: /Proposals/i });
      expect(proposalsButton).toHaveClass('bg-purple-600');

      const approvalsButton = screen.getByRole('button', { name: /Approvals/i });
      expect(approvalsButton).not.toHaveClass('bg-purple-600');

      // Verify only high and critical priorities are selected
      const highButton = screen.getByRole('button', { name: /High/i });
      const criticalButton = screen.getByRole('button', { name: /Critical/i });
      const normalButton = screen.getByRole('button', { name: /Normal/i });
      
      expect(highButton).toHaveClass('bg-purple-600');
      expect(criticalButton).toHaveClass('bg-purple-600');
      expect(normalButton).not.toHaveClass('bg-purple-600');

      // Verify unread status is selected
      const unreadButton = screen.getByRole('button', { name: /Unread/i });
      expect(unreadButton).toHaveClass('bg-purple-600');
    });

    it('does not interrupt typing in filter inputs', async () => {
      const { rerender } = render(
        <NotificationProvider>
          <NotificationCenter isOpen={true} onClose={vi.fn()} />
        </NotificationProvider>
      );

      // Open filter panel
      const filterButton = screen.getByText('Filter');
      fireEvent.click(filterButton);

      // Start interacting with filters
      const proposalsButton = screen.getByRole('button', { name: /Proposals/i });
      fireEvent.click(proposalsButton);

      // Rerender multiple times (simulating rapid updates)
      for (let i = 0; i < 5; i++) {
        rerender(
          <NotificationProvider>
            <NotificationCenter isOpen={true} onClose={vi.fn()} />
          </NotificationProvider>
        );
      }

      // Verify the user's selection is preserved
      const proposalsButtonAfter = screen.getByRole('button', { name: /Proposals/i });
      expect(proposalsButtonAfter).not.toHaveClass('bg-purple-600');
    });
  });
});
