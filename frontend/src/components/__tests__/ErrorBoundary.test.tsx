import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ErrorBoundary, { redactWalletAddresses, getContextActions, storeErrorDetail, ERROR_DETAIL_KEY } from '../ErrorBoundary';
import type { ErrorBoundaryContext } from '../ErrorBoundary';

// Mock errorAnalytics
vi.mock('../../utils/errorAnalytics', () => ({
  recordError: vi.fn(() => 'MOCK_ID_1'),
}));

// Must import after mock setup
import { recordError } from '../../utils/errorAnalytics';

// A component that always throws on render
function ThrowingComponent({ message }: { message: string }) {
  throw new Error(message);
}

// A component that renders normally
function GoodComponent() {
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Suppress React error boundary console noise
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('catches render error and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test render crash" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Test render crash/)).toBeInTheDocument();
  });

  it('shows Copy Error and Reload Page buttons in fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="button test error" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Copy Error')).toBeInTheDocument();
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
  });

  it('shows Try Again and Go Home buttons in fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="button test error" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Go Home')).toBeInTheDocument();
  });

  it('logs error to analytics when VITE_ERROR_REPORTING_ENABLED is set', () => {
    vi.stubEnv('VITE_ERROR_REPORTING_ENABLED', 'true');

    render(
      <ErrorBoundary>
        <ThrowingComponent message="Analytics test error" />
      </ErrorBoundary>
    );

    expect(recordError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'REACT_ERROR_BOUNDARY',
        message: 'Analytics test error',
      })
    );

    vi.unstubAllEnvs();
  });

  it('does NOT log error to analytics when VITE_ERROR_REPORTING_ENABLED is not set', () => {
    vi.unstubAllEnvs();

    render(
      <ErrorBoundary>
        <ThrowingComponent message="Should not report" />
      </ErrorBoundary>
    );

    expect(recordError).not.toHaveBeenCalled();
  });

  // ── Context-specific recovery actions ──────────────────────────────────────

  it('shows payment context actions: Retry, Save Draft, Contact Support', () => {
    render(
      <ErrorBoundary context="payment">
        <ThrowingComponent message="payment error" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Save Draft')).toBeInTheDocument();
    expect(screen.getByText('Contact Support')).toBeInTheDocument();
  });

  it('shows proposal context actions: Clear Form, Load Last Autosave', () => {
    render(
      <ErrorBoundary context="proposal">
        <ThrowingComponent message="proposal error" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Clear Form')).toBeInTheDocument();
    expect(screen.getByText('Load Last Autosave')).toBeInTheDocument();
  });

  it('shows dashboard context actions: Reset Widget Layout, Reload', () => {
    render(
      <ErrorBoundary context="dashboard">
        <ThrowingComponent message="dashboard error" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Reset Widget Layout')).toBeInTheDocument();
    expect(screen.getByText('Reload')).toBeInTheDocument();
  });

  it('shows no Recovery Options section for generic context', () => {
    render(
      <ErrorBoundary context="generic">
        <ThrowingComponent message="generic error" />
      </ErrorBoundary>
    );
    expect(screen.queryByText('Recovery Options')).not.toBeInTheDocument();
  });

  it('dispatches action via onRecoveryAction callback when payment action clicked', () => {
    const onAction = vi.fn();
    render(
      <ErrorBoundary context="payment" onRecoveryAction={onAction}>
        <ThrowingComponent message="pay error" />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(onAction).toHaveBeenCalledWith('retry');
  });

  it('dispatches save-draft action via onRecoveryAction callback', () => {
    const onAction = vi.fn();
    render(
      <ErrorBoundary context="payment" onRecoveryAction={onAction}>
        <ThrowingComponent message="pay error" />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Save Draft'));
    expect(onAction).toHaveBeenCalledWith('save-draft');
  });

  it('dispatches proposal context actions via callback', () => {
    const onAction = vi.fn();
    render(
      <ErrorBoundary context="proposal" onRecoveryAction={onAction}>
        <ThrowingComponent message="prop error" />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Clear Form'));
    expect(onAction).toHaveBeenCalledWith('clear-form');

    fireEvent.click(screen.getByText('Load Last Autosave'));
    expect(onAction).toHaveBeenCalledWith('load-autosave');
  });

  // ── Error detail storage ────────────────────────────────────────────────────

  it('stores error detail in localStorage when error occurs', () => {
    render(
      <ErrorBoundary context="payment">
        <ThrowingComponent message="storage test error" />
      </ErrorBoundary>
    );
    const stored = localStorage.getItem(ERROR_DETAIL_KEY);
    expect(stored).not.toBeNull();
    const detail = JSON.parse(stored!);
    expect(detail.message).toBe('storage test error');
    expect(detail.context).toBe('payment');
    expect(detail.timestamp).toBeDefined();
  });

  it('stored error detail includes context "proposal"', () => {
    render(
      <ErrorBoundary context="proposal">
        <ThrowingComponent message="proposal storage test" />
      </ErrorBoundary>
    );
    const detail = JSON.parse(localStorage.getItem(ERROR_DETAIL_KEY)!);
    expect(detail.context).toBe('proposal');
  });

  it('stored error detail defaults context to "generic" when not provided', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="no context" />
      </ErrorBoundary>
    );
    const detail = JSON.parse(localStorage.getItem(ERROR_DETAIL_KEY)!);
    expect(detail.context).toBe('generic');
  });
});

describe('getContextActions', () => {
  it('returns 3 actions for payment context', () => {
    const actions = getContextActions('payment');
    expect(actions.map((a) => a.label)).toEqual(['Retry', 'Save Draft', 'Contact Support']);
  });

  it('returns 2 actions for proposal context', () => {
    const actions = getContextActions('proposal');
    expect(actions.map((a) => a.label)).toEqual(['Clear Form', 'Load Last Autosave']);
  });

  it('returns 2 actions for dashboard context', () => {
    const actions = getContextActions('dashboard');
    expect(actions.map((a) => a.label)).toEqual(['Reset Widget Layout', 'Reload']);
  });

  it('returns empty array for generic context', () => {
    expect(getContextActions('generic')).toHaveLength(0);
  });

  it('payment Retry calls onAction with "retry"', () => {
    const cb = vi.fn();
    getContextActions('payment', cb).find((a) => a.label === 'Retry')!.handler();
    expect(cb).toHaveBeenCalledWith('retry');
  });

  it('proposal Clear Form calls onAction with "clear-form"', () => {
    const cb = vi.fn();
    getContextActions('proposal', cb).find((a) => a.label === 'Clear Form')!.handler();
    expect(cb).toHaveBeenCalledWith('clear-form');
  });
});

describe('storeErrorDetail', () => {
  beforeEach(() => localStorage.clear());

  it('stores a detail object under ERROR_DETAIL_KEY', () => {
    storeErrorDetail({ message: 'test', context: 'dashboard', timestamp: '2026-01-01T00:00:00Z' });
    const stored = JSON.parse(localStorage.getItem(ERROR_DETAIL_KEY)!);
    expect(stored.message).toBe('test');
    expect(stored.context).toBe('dashboard');
  });

  it('overwrites previous error detail', () => {
    storeErrorDetail({ message: 'first', context: 'payment', timestamp: 't1' });
    storeErrorDetail({ message: 'second', context: 'proposal', timestamp: 't2' });
    const stored = JSON.parse(localStorage.getItem(ERROR_DETAIL_KEY)!);
    expect(stored.message).toBe('second');
  });
});

describe('redactWalletAddresses', () => {
  it('redacts Stellar public keys (G...)', () => {
    // Valid Stellar address: G + 55 base32 chars = 56 total
    const address = 'GABCDE234567ABCDE234567ABCDE234567ABCDE234567ABCDE234567';
    const result = redactWalletAddresses(`Error with ${address}`);
    expect(result).toContain('G***REDACTED***');
    expect(result).not.toContain(address);
  });

  it('redacts Stellar contract keys (C...)', () => {
    const address = 'CABCDE234567ABCDE234567ABCDE234567ABCDE234567ABCDE234567';
    const result = redactWalletAddresses(`Error with ${address}`);
    expect(result).toContain('C***REDACTED***');
    expect(result).not.toContain(address);
  });

  it('redacts Ethereum-style addresses (0x...)', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    const result = redactWalletAddresses(`Error with ${address}`);
    expect(result).toContain('0x***REDACTED***');
    expect(result).not.toContain(address);
  });

  it('leaves non-address text unchanged', () => {
    const text = 'Something broke in the component';
    expect(redactWalletAddresses(text)).toBe(text);
  });
});
