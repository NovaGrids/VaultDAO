import React from 'react';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationProvider, useNotifications } from '../../context/NotificationContext';
import { CriticalNotificationOverlay } from '../CriticalNotificationOverlay';
import type { Notification } from '../../types/notification';

// A valid Stellar address format: G + 55 chars
const VALID_STELLAR_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';

// Mock useWallet
const mockSignTransaction = vi.fn().mockResolvedValue('signed_dummy_xdr');
vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({
    address: VALID_STELLAR_ADDRESS,
    isConnected: true,
    signTransaction: mockSignTransaction,
  }),
}));

describe('Notification Priority System, Overlay, Acknowledge & Bulk Actions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // Mock global fetch for API sync
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NotificationProvider>{children}</NotificationProvider>
  );

  it('priority sorting groups critical, then high, then normal/low', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      // Add normal first
      result.current.addNotification({
        title: 'Normal Title',
        message: 'Normal Msg',
        category: 'system',
        priority: 'normal',
      });
      // Add high second
      result.current.addNotification({
        title: 'High Title',
        message: 'High Msg',
        category: 'proposals',
        priority: 'high',
      });
      // Add critical third
      result.current.addNotification({
        title: 'Critical Title',
        message: 'Critical Msg',
        category: 'approvals',
        priority: 'critical',
      });
    });

    // Verify ordering in state
    expect(result.current.notifications[0].priority).toBe('critical');
    expect(result.current.notifications[1].priority).toBe('high');
    expect(result.current.notifications[2].priority).toBe('normal');
  });

  it('critical overlay triggers if unread for > 5 minutes', async () => {
    let addNotifFn: any;
    let getNotifsFn: any;

    const TestComponent = () => {
      const { addNotification, notifications } = useNotifications();
      addNotifFn = addNotification;
      getNotifsFn = () => notifications;
      return <CriticalNotificationOverlay />;
    };

    const { rerender } = render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    // Initial state: no critical overlay should be in document
    expect(screen.queryByText(/Critical Treasury/i)).not.toBeInTheDocument();

    // Add a critical notification
    act(() => {
      addNotifFn({
        title: 'Drain Attack Detected',
        message: 'Treasury drain attempted on vault #1',
        category: 'system',
        priority: 'critical',
      });
    });

    // Mutate the timestamp in state to simulate elapsed time (6 minutes ago)
    act(() => {
      getNotifsFn()[0].timestamp = Date.now() - (6 * 60 * 1000);
    });

    // Re-render test component inside the same provider to trigger useEffect hook check
    rerender(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    // Now it should trigger the overlay
    await waitFor(() => {
      expect(screen.getByText(/Critical Treasury/i)).toBeInTheDocument();
      expect(screen.getByText('Drain Attack Detected')).toBeInTheDocument();
    });
  });

  it('acknowledge flow requires wallet signature, updates read receipts and status', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({
        title: 'Security Alert',
        message: 'Alert msg',
        category: 'system',
        priority: 'critical',
      });
    });

    const notif = result.current.notifications[0];
    expect(notif.acknowledged).toBeUndefined();

    // Acknowledge notification
    await act(async () => {
      await result.current.acknowledgeNotification(notif.id, mockSignTransaction, VALID_STELLAR_ADDRESS);
    });

    // Check updated status in state
    const updated = result.current.notifications[0];
    expect(updated.status).toBe('read');
    expect(updated.acknowledged).toBe(true);
    expect(updated.acknowledgeSignature).toBe('signed_dummy_xdr');

    // Check localStorage read receipt
    const storedReceipts = JSON.parse(localStorage.getItem('vaultdao_notif_receipts') || '[]');
    expect(storedReceipts.length).toBe(1);
    expect(storedReceipts[0].notificationId).toBe(notif.id);
    expect(storedReceipts[0].signer).toBe(VALID_STELLAR_ADDRESS);
    expect(storedReceipts[0].signature).toBe('signed_dummy_xdr');
  });

  it('bulk action "Archive all normal" removes normal and low priority notifications', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({
        title: 'Critical',
        message: 'Msg',
        category: 'system',
        priority: 'critical',
      });
      result.current.addNotification({
        title: 'Normal',
        message: 'Msg',
        category: 'system',
        priority: 'normal',
      });
      result.current.addNotification({
        title: 'High',
        message: 'Msg',
        category: 'system',
        priority: 'high',
      });
      result.current.addNotification({
        title: 'Low',
        message: 'Msg',
        category: 'system',
        priority: 'low',
      });
    });

    expect(result.current.notifications.length).toBe(4);

    act(() => {
      result.current.archiveAllNormal();
    });

    // Archive should remove Normal & Low, keeping Critical & High
    expect(result.current.notifications.length).toBe(2);
    const priorities = result.current.notifications.map(n => n.priority);
    expect(priorities).toContain('critical');
    expect(priorities).toContain('high');
    expect(priorities).not.toContain('normal');
    expect(priorities).not.toContain('low');
  });
});
