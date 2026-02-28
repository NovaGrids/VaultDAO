/**
 * Tests for NotificationItem component
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest with @testing-library/react.
 */

import type { Notification } from '../../types/notification';

describe('NotificationItem', () => {
  const mockNotification: Notification = {
    id: '1',
    category: 'proposals',
    priority: 'high',
    status: 'unread',
    title: 'Test Notification',
    message: 'This is a test notification message',
    timestamp: Date.now() - 3600000, // 1 hour ago
  };

  const mockHandlers = {
    onMarkAsRead: vi.fn(),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notification content correctly', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    expect(screen.getByText('Test Notification')).toBeInTheDocument();
    expect(screen.getByText('This is a test notification message')).toBeInTheDocument();
  });

  it('displays category correctly', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    expect(screen.getByText('proposals')).toBeInTheDocument();
  });

  it('displays priority correctly', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('shows unread indicator for unread notifications', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    const unreadIndicator = screen.getByLabelText('Unread notification');
    expect(unreadIndicator).toBeInTheDocument();
  });

  it('does not show unread indicator for read notifications', () => {
    const readNotification = { ...mockNotification, status: 'read' as const };
    render(<NotificationItem notification={readNotification} {...mockHandlers} />);
    
    expect(screen.queryByLabelText('Unread notification')).not.toBeInTheDocument();
  });

  it('calls onMarkAsRead when clicked and unread', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    const item = screen.getByRole('article');
    fireEvent.click(item);
    
    expect(mockHandlers.onMarkAsRead).toHaveBeenCalledWith('1');
  });

  it('does not call onMarkAsRead when clicked and already read', () => {
    const readNotification = { ...mockNotification, status: 'read' as const };
    render(<NotificationItem notification={readNotification} {...mockHandlers} />);
    
    const item = screen.getByRole('article');
    fireEvent.click(item);
    
    expect(mockHandlers.onMarkAsRead).not.toHaveBeenCalled();
  });

  it('formats timestamp correctly', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    expect(screen.getByText('1h ago')).toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    const notificationWithActions: Notification = {
      ...mockNotification,
      actions: [
        { id: 'view', label: 'View', type: 'view' },
        { id: 'approve', label: 'Approve', type: 'approve' },
      ],
    };
    
    render(<NotificationItem notification={notificationWithActions} {...mockHandlers} />);
    
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('applies correct priority styles', () => {
    const { container } = render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    const notificationElement = container.querySelector('.border-l-orange-500');
    expect(notificationElement).toBeInTheDocument();
  });

  it('has accessible ARIA attributes', () => {
    render(<NotificationItem notification={mockNotification} {...mockHandlers} />);
    
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'proposals notification: Test Notification');
  });
});
