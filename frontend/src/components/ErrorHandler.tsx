/**
 * Multi-level error boundaries with fallback UI and recovery suggestions.
 * Mobile responsive.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { getUserFriendlyError } from '../utils/errorMapping';
import { reportError } from './ErrorReporting';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  level?: 'app' | 'layout' | 'section';
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

function getErrorMessage(error: Error): { title: string; message: string; suggestions: string[]; canRetry: boolean } {
  const friendly = getUserFriendlyError(error);
  return {
    title: friendly.title,
    message: friendly.message,
    suggestions: friendly.recoverySuggestions,
    canRetry: friendly.canRetry,
  };
}

/**
 * Default fallback UI: user-friendly message, recovery suggestions, retry button.
 * Works for app, layout, and section levels; responsive.
 */
function DefaultFallback({
  error,
  onRetry,
  level,
}: {
  error: Error;
  onRetry: () => void;
  level: 'app' | 'layout' | 'section';
}) {
  const { title, message, suggestions, canRetry } = getErrorMessage(error);
  const isApp = level === 'app';

  return (
    <div
      className={`
        flex min-h-0 flex-col rounded-xl border border-red-900/50 bg-gray-900/95 p-4 text-left
        sm:p-6 md:p-8
        ${isApp ? 'min-h-[100dvh] items-center justify-center px-4 py-8' : ''}
      `}
      role="alert"
    >
      <div className={`flex flex-col gap-4 ${isApp ? 'max-w-md' : ''}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-400 sm:h-7 sm:w-7" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold text-white sm:text-xl">{title}</h2>
            <p className="mt-1 text-sm text-gray-300 sm:text-base">{message}</p>
          </div>
        </div>

        {suggestions.length > 0 && (
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            {suggestions.slice(0, 3).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}

        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Network-offline fallback (optional; use when you detect offline).
 */
export function OfflineFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-amber-900/50 bg-gray-900/95 p-6 text-center"
      role="alert"
    >
      <WifiOff className="h-12 w-12 text-amber-400" aria-hidden />
      <div>
        <h2 className="text-lg font-semibold text-white">You're offline</h2>
        <p className="mt-1 text-sm text-gray-400">Check your connection and try again.</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Generic error boundary with level and optional custom fallback.
 */
class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportError({
      code: 'BOUNDARY',
      message: error.message,
      stack: error.stack,
      context: errorInfo.componentStack ?? undefined,
    });
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, level = 'section' } = this.props;

    if (hasError && error) {
      if (fallback) return fallback;
      return (
        <DefaultFallback
          error={error}
          onRetry={this.handleRetry}
          level={level}
        />
      );
    }

    return children;
  }
}

/**
 * App-level boundary: wrap the root app (e.g. in main.tsx).
 */
export function AppErrorBoundary({ children, onError }: { children: ReactNode; onError?: (error: Error, errorInfo: ErrorInfo) => void }) {
  return (
    <ErrorBoundaryClass level="app" onError={onError}>
      {children}
    </ErrorBoundaryClass>
  );
}

/**
 * Layout-level boundary: wrap dashboard layout so one section failing doesn’t break the whole app.
 */
export function LayoutErrorBoundary({ children, onError }: { children: ReactNode; onError?: (error: Error, errorInfo: ErrorInfo) => void }) {
  return (
    <ErrorBoundaryClass level="layout" onError={onError}>
      {children}
    </ErrorBoundaryClass>
  );
}

/**
 * Section-level boundary: wrap individual routes or heavy widgets.
 */
export function SectionErrorBoundary({ children, fallback, onError }: {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}) {
  return (
    <ErrorBoundaryClass level="section" fallback={fallback} onError={onError}>
      {children}
    </ErrorBoundaryClass>
  );
}

export default ErrorBoundaryClass;
