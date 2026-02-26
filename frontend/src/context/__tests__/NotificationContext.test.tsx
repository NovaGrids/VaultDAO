/**
 * Tests for NotificationContext
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest with @testing-library/react.
 */

import type { NotificationCategory, NotificationPriority } from '../../types/notification';

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

describe('NotificationContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NotificationProvider>{children}</NotificationProvider>
  );

  it('provides initial state', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
  });

  it('adds a notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test',
        message: 'Test message',
        category: 'system',
        priority: 'normal',
      });
    });
    
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].title).toBe('Test');
    expect(result.current.notifications[0].status).toBe('unread');
    expect(result.current.unreadCount).toBe(1);
  });

  it('marks notification as read', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test',
        message: 'Test message',
        category: 'system',
        priority: 'normal',
      });
    });
    
    const notificationId = result.current.notifications[0].id;
    
    act(() => {
      result.current.markAsRead(notificationId);
    });
    
    expect(result.current.notifications[0].status).toBe('read');
    expect(result.current.unreadCount).toBe(0);
  });

  it('marks all notifications as read', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test 1',
        message: 'Message 1',
        category: 'system',
        priority: 'normal',
      });
      result.current.addNotification({
        title: 'Test 2',
        message: 'Message 2',
        category: 'proposals',
        priority: 'high',
      });
    });
    
    expect(result.current.unreadCount).toBe(2);
    
    act(() => {
      result.current.markAllAsRead();
    });
    
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications.every((n) => n.status === 'read')).toBe(true);
  });

  it('dismisses a notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test',
        message: 'Test message',
        category: 'system',
        priority: 'normal',
      });
    });
    
    const notificationId = result.current.notifications[0].id;
    
    act(() => {
      result.current.dismissNotification(notificationId);
    });
    
    expect(result.current.notifications).toHaveLength(0);
  });

  it('clears all notifications', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test 1',
        message: 'Message 1',
        category: 'system',
        priority: 'normal',
      });
      result.current.addNotification({
        title: 'Test 2',
        message: 'Message 2',
        category: 'proposals',
        priority: 'high',
      });
    });
    
    expect(result.current.notifications).toHaveLength(2);
    
    act(() => {
      result.current.clearAll();
    });
    
    expect(result.current.notifications).toHaveLength(0);
  });

  it('updates filter', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.setFilter({ categories: ['proposals'] });
    });
    
    expect(result.current.filter.categories).toEqual(['proposals']);
    expect(result.current.page).toBe(1); // Should reset page
  });

  it('updates sort', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.setSort({ by: 'priority', order: 'asc' });
    });
    
    expect(result.current.sort.by).toBe('priority');
    expect(result.current.sort.order).toBe('asc');
    expect(result.current.page).toBe(1); // Should reset page
  });

  it('updates page', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.setPage(3);
    });
    
    expect(result.current.page).toBe(3);
  });

  it('persists notifications to localStorage', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test',
        message: 'Test message',
        category: 'system',
        priority: 'normal',
      });
    });
    
    const stored = localStorageMock.getItem('vaultdao_notifications');
    expect(stored).toBeTruthy();
    
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Test');
  });

  it('loads notifications from localStorage on mount', () => {
    const mockData = [
      {
        id: '1',
        title: 'Stored',
        message: 'Stored message',
        category: 'system' as NotificationCategory,
        priority: 'normal' as NotificationPriority,
        status: 'unread' as const,
        timestamp: Date.now(),
      },
    ];
    
    localStorageMock.setItem('vaultdao_notifications', JSON.stringify(mockData));
    
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].title).toBe('Stored');
  });

  it('generates unique IDs for notifications', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    
    act(() => {
      result.current.addNotification({
        title: 'Test 1',
        message: 'Message 1',
        category: 'system',
        priority: 'normal',
      });
      result.current.addNotification({
        title: 'Test 2',
        message: 'Message 2',
        category: 'system',
        priority: 'normal',
      });
    });
    
    const ids = result.current.notifications.map((n) => n.id);
    expect(new Set(ids).size).toBe(2); // All IDs should be unique
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useNotifications());
    }).toThrow('useNotifications must be used within NotificationProvider');
    
    consoleSpy.mockRestore();
  });
});
