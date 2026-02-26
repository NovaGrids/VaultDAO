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
});
