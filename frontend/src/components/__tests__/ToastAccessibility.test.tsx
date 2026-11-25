import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import ToastContainer, { ToastItem } from '../ToastContainer';
import Toast from '../Toast';
import RealtimeNotifications from '../RealtimeNotifications';

expect.extend(toHaveNoViolations);

// Mock lucide-react icons for consistency
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon" aria-hidden="true" />,
  CheckCircle: () => <span data-testid="check-icon" aria-hidden="true" />,
  AlertCircle: () => <span data-testid="alert-icon" aria-hidden="true" />,
  Info: () => <span data-testid="info-icon" aria-hidden="true" />,
  AlertTriangle: () => <span data-testid="warning-icon" aria-hidden="true" />,
  XCircle: () => <span data-testid="xcircle-icon" aria-hidden="true" />,
}));

const mockContextValue = {
  subscribe: vi.fn(),
  isConnected: true,
};

vi.mock('../../context/RealtimeContext', () => ({
  useRealtime: () => mockContextValue,
}));

describe('Transaction Status Notifications Accessibility (#2155)', () => {
  describe('ToastContainer aria-live Region', () => {
    it('wraps the notification container in an aria-live="polite" aria-atomic="true" region', () => {
      render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />);

      const container = screen.getByRole('region', { name: /notification container/i });
      expect(container).toBeInTheDocument();
      expect(container).toHaveAttribute('aria-live', 'polite');
      expect(container).toHaveAttribute('aria-atomic', 'true');
    });

    it('has no accessibility violations when empty', async () => {
      const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with active toasts', async () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'Transaction submitted successfully', type: 'success' },
        { id: '2', message: 'Transaction failed: insufficient balance', type: 'error' },
      ];
      const { container } = render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Toast aria-live and role behavior', () => {
    it('uses aria-live="assertive" and role="alert" for error notifications', () => {
      render(
        <Toast
          id="err-1"
          message="Transaction failed on ledger submission"
          type="error"
          onClose={vi.fn()}
        />
      );

      const errorToast = screen.getByRole('alert');
      expect(errorToast).toBeInTheDocument();
      expect(errorToast).toHaveAttribute('aria-live', 'assertive');
      expect(errorToast).toHaveAttribute('aria-atomic', 'true');
      expect(errorToast).toHaveTextContent('Transaction failed on ledger submission');
    });

    it('uses aria-live="polite" and role="status" for success notifications', () => {
      render(
        <Toast
          id="succ-1"
          message="Transaction confirmed on Testnet"
          type="success"
          onClose={vi.fn()}
        />
      );

      const successToast = screen.getByRole('status');
      expect(successToast).toBeInTheDocument();
      expect(successToast).toHaveAttribute('aria-live', 'polite');
      expect(successToast).toHaveAttribute('aria-atomic', 'true');
      expect(successToast).toHaveTextContent('Transaction confirmed on Testnet');
    });

    it('uses aria-live="polite" and role="status" for info and warning notifications', () => {
      const { rerender } = render(
        <Toast
          id="info-1"
          message="Transaction is being processed"
          type="info"
          onClose={vi.fn()}
        />
      );

      const infoToast = screen.getByRole('status');
      expect(infoToast).toHaveAttribute('aria-live', 'polite');

      rerender(
        <Toast
          id="warn-1"
          message="High network fee detected"
          type="warning"
          onClose={vi.fn()}
        />
      );

      const warnToast = screen.getByRole('status');
      expect(warnToast).toHaveAttribute('aria-live', 'polite');
    });

    it('has no accessibility violations for success notifications', async () => {
      const { container } = render(
        <Toast
          id="test-succ"
          message="Transaction broadcasted"
          type="success"
          onClose={vi.fn()}
        />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations for error notifications', async () => {
      const { container } = render(
        <Toast
          id="test-err"
          message="Transaction failed"
          type="error"
          onClose={vi.fn()}
        />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('provides accessible dismiss button with aria-label', () => {
      render(
        <Toast
          id="dismiss-test"
          message="Proposal status updated"
          type="info"
          onClose={vi.fn()}
        />
      );

      const dismissBtn = screen.getByRole('button', { name: /dismiss notification/i });
      expect(dismissBtn).toBeInTheDocument();
    });
  });

  describe('RealtimeNotifications aria-live behavior', () => {
    it('renders notification container with aria-live="polite" and aria-atomic="true"', () => {
      let callbackRef: ((data: unknown) => void) | undefined;
      mockContextValue.subscribe.mockImplementation((event: string, cb: (data: unknown) => void) => {
        if (event === 'notification') callbackRef = cb;
        return () => {};
      });

      const { rerender } = render(<RealtimeNotifications />);
      expect(screen.queryByRole('region', { name: /notification container/i })).not.toBeInTheDocument();

      // Trigger notification
      callbackRef?.({
        type: 'error',
        title: 'Transaction Error',
        message: 'Contract invocation failed',
      });

      rerender(<RealtimeNotifications />);

      const container = screen.getByRole('region', { name: /notification container/i });
      expect(container).toBeInTheDocument();
      expect(container).toHaveAttribute('aria-live', 'polite');
      expect(container).toHaveAttribute('aria-atomic', 'true');

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });
  });
});
