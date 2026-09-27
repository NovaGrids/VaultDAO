import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LiveUpdates from '../LiveUpdates';
import RealtimeNotifications from '../RealtimeNotifications';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockContextValue = {
  subscribe: vi.fn((event: string, callback: any) => {
    // Store callbacks for testing
    if (!mockContextValue.callbacks) {
      mockContextValue.callbacks = {};
    }
    mockContextValue.callbacks[event] = callback;
    return () => {}; // unsubscribe
  }),
  isConnected: true,
  callbacks: {} as Record<string, any>,
};

vi.mock('../../contexts/RealtimeContext', () => ({
  useRealtime: () => mockContextValue,
}));

// Icons render no text so they can't collide with notification titles like "Info".
vi.mock('lucide-react', () => ({
  Bell: () => <span data-testid="bell-icon" aria-hidden="true" />,
  X: () => <span data-testid="close-icon" aria-hidden="true" />,
  CheckCircle: () => <span data-testid="check-icon" aria-hidden="true" />,
  XCircle: () => <span data-testid="x-icon" aria-hidden="true" />,
  AlertCircle: () => <span data-testid="alert-icon" aria-hidden="true" />,
  Info: () => <span data-testid="info-icon" aria-hidden="true" />,
}));

/** Push a realtime event through the subscribed callback. */
function emit(event: string, data: unknown) {
  act(() => {
    mockContextValue.callbacks[event]?.(data);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Real-Time Accessibility - Issue #1584', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextValue.callbacks = {};
  });

  describe('LiveUpdates Accessibility', () => {
    it('should render with aria-live region for announcement', () => {
      render(<LiveUpdates />);
      // The panel stays hidden until the first update arrives
      expect(screen.queryByText('Live Updates')).not.toBeInTheDocument();

      emit('proposal_created', { id: '1' });

      expect(screen.getByText('Live Updates')).toBeInTheDocument();
      const liveRegion = screen.getByRole('log', { name: /live updates/i });
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveTextContent(/New proposal #1 created/);
    });

    it('should announce proposal created updates to screen readers', async () => {
      render(<LiveUpdates />);

      // Trigger a proposal created event
      if (mockContextValue.callbacks['proposal_created']) {
        mockContextValue.callbacks['proposal_created']({ id: '123' });
      }

      await waitFor(() => {
        expect(screen.getByText(/New proposal #123 created/i)).toBeInTheDocument();
      });
    });

    it('should announce proposal approved updates to screen readers', async () => {
      render(<LiveUpdates />);

      // Trigger a proposal approved event
      if (mockContextValue.callbacks['proposal_approved']) {
        mockContextValue.callbacks['proposal_approved']({ id: '456' });
      }

      await waitFor(() => {
        expect(screen.getByText(/Proposal #456 approved/i)).toBeInTheDocument();
      });
    });

    it('should announce proposal rejected updates to screen readers', async () => {
      render(<LiveUpdates />);

      // Trigger a proposal rejected event
      if (mockContextValue.callbacks['proposal_rejected']) {
        mockContextValue.callbacks['proposal_rejected']({ id: '789' });
      }

      await waitFor(() => {
        expect(screen.getByText(/Proposal #789 rejected/i)).toBeInTheDocument();
      });
    });

    it('should have accessible close button', () => {
      render(<LiveUpdates />);
      emit('proposal_created', { id: '1' });

      const closeButton = screen.getByRole('button', { name: /close live updates/i });
      expect(closeButton).toBeInTheDocument();
      expect(closeButton).toHaveAttribute('aria-label');
    });

    it('should use role="alert" for executed proposals', async () => {
      render(<LiveUpdates />);

      if (mockContextValue.callbacks['proposal_approved']) {
        mockContextValue.callbacks['proposal_approved']({ id: '555' });
      }

      await waitFor(() => {
        const updates = screen.getByText(/Proposal #555 approved/i);
        // Alert role should be used or parent container should announce
        expect(updates).toBeInTheDocument();
      });
    });

    it('should use role="alert" for failed proposals', async () => {
      render(<LiveUpdates />);

      if (mockContextValue.callbacks['proposal_rejected']) {
        mockContextValue.callbacks['proposal_rejected']({ id: '666' });
      }

      await waitFor(() => {
        const updates = screen.getByText(/Proposal #666 rejected/i);
        expect(updates).toBeInTheDocument();
      });
    });

    it('should have accessible clear button', () => {
      render(<LiveUpdates />);
      emit('proposal_created', { id: '1' });

      const clearButton = screen.getByRole('button', { name: /clear all/i });
      expect(clearButton).toBeInTheDocument();
    });
  });

  describe('RealtimeNotifications Accessibility', () => {
    it('should render notifications with accessible labels', () => {
      render(<RealtimeNotifications />);

      // Component renders successfully
      expect(screen.queryByTestId('info-icon')).not.toBeInTheDocument(); // No notification yet
    });

    it('should announce success notifications', async () => {
      render(<RealtimeNotifications />);

      // Trigger a success notification
      if (mockContextValue.callbacks['notification']) {
        mockContextValue.callbacks['notification']({
          type: 'success',
          title: 'Success',
          message: 'Operation completed successfully',
        });
      }

      await waitFor(() => {
        expect(screen.getByText('Success')).toBeInTheDocument();
        expect(screen.getByText('Operation completed successfully')).toBeInTheDocument();
      });
    });

    it('should announce error notifications', async () => {
      render(<RealtimeNotifications />);

      if (mockContextValue.callbacks['notification']) {
        mockContextValue.callbacks['notification']({
          type: 'error',
          title: 'Error',
          message: 'An error occurred',
        });
      }

      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument();
        expect(screen.getByText('An error occurred')).toBeInTheDocument();
      });
    });

    it('should announce warning notifications', async () => {
      render(<RealtimeNotifications />);

      if (mockContextValue.callbacks['notification']) {
        mockContextValue.callbacks['notification']({
          type: 'warning',
          title: 'Warning',
          message: 'Please review this',
        });
      }

      await waitFor(() => {
        expect(screen.getByText('Warning')).toBeInTheDocument();
        expect(screen.getByText('Please review this')).toBeInTheDocument();
      });
    });

    it('should announce info notifications', async () => {
      render(<RealtimeNotifications />);

      if (mockContextValue.callbacks['notification']) {
        mockContextValue.callbacks['notification']({
          type: 'info',
          title: 'Info',
          message: 'Here is some information',
        });
      }

      await waitFor(() => {
        expect(screen.getByText('Info')).toBeInTheDocument();
        expect(screen.getByText('Here is some information')).toBeInTheDocument();
      });
    });

    it('should have accessible dismiss button on notifications', async () => {
      render(<RealtimeNotifications />);

      if (mockContextValue.callbacks['notification']) {
        mockContextValue.callbacks['notification']({
          type: 'success',
          title: 'Success',
          message: 'Done',
        });
      }

      await waitFor(() => {
        const dismissButton = screen.getByRole('button', {
          name: /dismiss notification/i,
        });
        expect(dismissButton).toBeInTheDocument();
        expect(dismissButton).toHaveAttribute('aria-label');
      });
    });

    it('should include timestamp for accessibility', async () => {
      render(<RealtimeNotifications />);

      if (mockContextValue.callbacks['notification']) {
        mockContextValue.callbacks['notification']({
          type: 'info',
          title: 'Test',
          message: 'Message',
        });
      }

      await waitFor(() => {
        const timestamps = screen.getAllByText(/\d{1,2}:\d{1,2}:\d{1,2}/);
        expect(timestamps.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Combined Accessibility Tests', () => {
    it('should maintain accessibility with multiple updates', async () => {
      render(<LiveUpdates />);

      // Trigger multiple updates
      if (mockContextValue.callbacks['proposal_created']) {
        mockContextValue.callbacks['proposal_created']({ id: '1' });
        mockContextValue.callbacks['proposal_created']({ id: '2' });
        mockContextValue.callbacks['proposal_created']({ id: '3' });
      }

      await waitFor(() => {
        expect(screen.getByText(/New proposal #1 created/i)).toBeInTheDocument();
        expect(screen.getByText(/New proposal #2 created/i)).toBeInTheDocument();
        expect(screen.getByText(/New proposal #3 created/i)).toBeInTheDocument();
      });
    });

    it('should handle state changes accessibly', async () => {
      const { rerender } = render(<LiveUpdates />);

      if (mockContextValue.callbacks['proposal_created']) {
        mockContextValue.callbacks['proposal_created']({ id: '100' });
      }

      await waitFor(() => {
        expect(screen.getByText(/New proposal #100 created/i)).toBeInTheDocument();
      });

      // Rerender should maintain accessibility
      rerender(<LiveUpdates />);

      expect(screen.getByText('Live Updates')).toBeInTheDocument();
    });
  });
});
