import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotificationCenter from '../NotificationCenter';
import type { Notification } from '../../types/notification';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockMarkAsRead = vi.fn();
const mockMarkAllAsRead = vi.fn();
const mockDismiss = vi.fn();
const mockSetFilter = vi.fn();
const mockSetSort = vi.fn();
const mockClearAll = vi.fn();
const mockUpdateTypeSettings = vi.fn();

const makeNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: `notif-${Math.random()}`,
  category: 'proposals',
  priority: 'normal',
  status: 'unread',
  title: 'Test notification',
  message: 'Test message',
  timestamp: Date.now(),
  ...overrides,
});

let mockNotifications: Notification[] = [];

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: mockNotifications.filter(n => n.status === 'unread').length,
    filter: { categories: ['proposals', 'approvals', 'system', 'payments'], priorities: ['critical', 'high', 'normal', 'low'] },
    sort: { by: 'timestamp', order: 'desc' },
    page: 1,
    pageSize: 20,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
    dismissNotification: mockDismiss,
    setFilter: mockSetFilter,
    setSort: mockSetSort,
    setPage: vi.fn(),
    clearAll: mockClearAll,
    connectionStatus: 'connected',
    typeSettings: { disabledCategories: [], muteSounds: false },
    updateTypeSettings: mockUpdateTypeSettings,
  }),
}));

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({
    address: 'GBTESTWALLET',
    isConnected: true,
    signTransaction: vi.fn().mockResolvedValue('mock_sig'),
  }),
}));

vi.mock('react-infinite-scroll-component', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications = [];
  });

  it('renders when isOpen is true', () => {
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<NotificationCenter isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows unread count badge', () => {
    mockNotifications = [makeNotification({ status: 'unread' }), makeNotification({ status: 'unread' })];
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('groups notifications by priority — urgent section appears first', () => {
    mockNotifications = [
      makeNotification({ priority: 'critical', title: 'Critical alert' }),
      makeNotification({ priority: 'normal', title: 'Normal info' }),
    ];
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    const sections = screen.getAllByRole('button', { name: /^(urgent|normal)/i });
    // Urgent section header should appear before Normal
    expect(sections[0].textContent).toMatch(/urgent/i);
  });

  it('collapses normal and low priority sections by default', () => {
    mockNotifications = [makeNotification({ priority: 'normal', title: 'Normal notification' })];
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    // Normal section header exists but items are collapsed
    expect(screen.getByRole('button', { name: /^normal/i })).toBeInTheDocument();
    expect(screen.queryByText('Normal notification')).not.toBeInTheDocument();
  });

  it('expands a collapsed section on click', () => {
    mockNotifications = [makeNotification({ priority: 'normal', title: 'Normal notification' })];
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    const normalHeader = screen.getByRole('button', { name: /^normal/i });
    fireEvent.click(normalHeader);
    expect(screen.getByText('Normal notification')).toBeInTheDocument();
  });

  it('calls markAllAsRead when "Mark all read" is clicked', () => {
    mockNotifications = [makeNotification()];
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Mark all read'));
    expect(mockMarkAllAsRead).toHaveBeenCalledOnce();
  });

  it('calls clearAll when "Clear all" is clicked', () => {
    mockNotifications = [makeNotification()];
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Clear all'));
    expect(mockClearAll).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<NotificationCenter isOpen onClose={onClose} />);
    // Click the backdrop (first div with aria-hidden)
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('toggles mute via the mute button', () => {
    render(<NotificationCenter isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Mute notification sounds'));
    expect(mockUpdateTypeSettings).toHaveBeenCalledWith({ muteSounds: true });
  });
});
