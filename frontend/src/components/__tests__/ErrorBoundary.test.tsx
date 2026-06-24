import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ErrorBoundary, { redactWalletAddresses } from '../ErrorBoundary';

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
    // Enable error reporting via import.meta.env mock
    const originalEnv = (import.meta as any).env;
    (import.meta as any).env = { ...originalEnv, VITE_ERROR_REPORTING_ENABLED: 'true' };

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

    // Restore env
    (import.meta as any).env = originalEnv;
  });

  it('does NOT log error to analytics when VITE_ERROR_REPORTING_ENABLED is not set', () => {
    const originalEnv = (import.meta as any).env;
    (import.meta as any).env = { ...originalEnv, VITE_ERROR_REPORTING_ENABLED: undefined };

    render(
      <ErrorBoundary>
        <ThrowingComponent message="Should not report" />
      </ErrorBoundary>
    );

    expect(recordError).not.toHaveBeenCalled();

    (import.meta as any).env = originalEnv;
  });
});

describe('redactWalletAddresses', () => {
  it('redacts Stellar public keys (G...)', () => {
    const address = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY';
    const result = redactWalletAddresses(`Error with ${address}`);
    expect(result).toContain('G***REDACTED***');
    expect(result).not.toContain(address);
  });

  it('redacts Stellar contract keys (C...)', () => {
    const address = 'CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY';
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
