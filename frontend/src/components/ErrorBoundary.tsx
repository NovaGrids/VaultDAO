import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Copy, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { recordError } from '../utils/errorAnalytics';

export type ErrorBoundaryContext = 'payment' | 'proposal' | 'dashboard' | 'generic';

export const ERROR_DETAIL_KEY = 'vaultdao_last_error_detail';

export interface ErrorDetail {
  message: string;
  stack?: string;
  componentStack?: string;
  context: ErrorBoundaryContext;
  timestamp: string;
}

export function storeErrorDetail(detail: ErrorDetail): void {
  try {
    localStorage.setItem(ERROR_DETAIL_KEY, JSON.stringify(detail));
  } catch {
    // ignore storage errors
  }
}

export interface ContextAction {
  label: string;
  handler: () => void;
}

export function getContextActions(
  context: ErrorBoundaryContext,
  onAction?: (action: string) => void,
): ContextAction[] {
  const dispatch = (action: string) => onAction?.(action);
  switch (context) {
    case 'payment':
      return [
        { label: 'Retry', handler: () => dispatch('retry') },
        { label: 'Save Draft', handler: () => dispatch('save-draft') },
        { label: 'Contact Support', handler: () => dispatch('contact-support') },
      ];
    case 'proposal':
      return [
        { label: 'Clear Form', handler: () => dispatch('clear-form') },
        { label: 'Load Last Autosave', handler: () => dispatch('load-autosave') },
      ];
    case 'dashboard':
      return [
        { label: 'Reset Widget Layout', handler: () => dispatch('reset-layout') },
        { label: 'Reload', handler: () => window.location.reload() },
      ];
    default:
      return [];
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
  context?: ErrorBoundaryContext;
  onRecoveryAction?: (action: string) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
  componentStack: string | null;
  showComponentStack: boolean;
  copied: boolean;
}

/**
 * Redact wallet addresses from error text to avoid leaking sensitive info.
 */
export function redactWalletAddresses(text: string): string {
  return text
    .replace(/\bG[A-Z2-7]{55}\b/g, 'G***REDACTED***')
    .replace(/\bC[A-Z2-7]{55}\b/g, 'C***REDACTED***')
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, '0x***REDACTED***');
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorId: null,
    componentStack: null,
    showComponentStack: false,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, errorId: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const isReportingEnabled = import.meta.env.VITE_ERROR_REPORTING_ENABLED;

    const redactedMessage = redactWalletAddresses(error.message || 'Unknown error');
    const redactedStack = error.stack ? redactWalletAddresses(error.stack) : undefined;
    const redactedContext = errorInfo.componentStack
      ? redactWalletAddresses(errorInfo.componentStack)
      : undefined;

    this.setState({ componentStack: redactedContext || null });

    // Store error detail in localStorage for debugging
    storeErrorDetail({
      message: redactedMessage,
      stack: redactedStack,
      componentStack: redactedContext,
      context: this.props.context ?? 'generic',
      timestamp: new Date().toISOString(),
    });

    if (isReportingEnabled) {
      let errorId = '';
      try {
        errorId = recordError({
          code: 'REACT_ERROR_BOUNDARY',
          message: redactedMessage,
          stack: redactedStack,
          context: redactedContext,
        });
        this.setState({ errorId });
      } catch (reportingError) {
        console.error('Failed to report error to analytics:', reportingError);
      }
    }

    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }
  }

  private handleTryAgain = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorId: null,
      componentStack: null,
      showComponentStack: false,
      copied: false,
    });
  };

  private handleGoHome = (): void => {
    window.location.href = '/';
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleCopyError = async (): Promise<void> => {
    const { error, componentStack } = this.state;
    if (!error) return;

    const redactedMessage = redactWalletAddresses(error.message || 'Unknown error');
    const redactedStack = error.stack ? redactWalletAddresses(error.stack) : '';

    let text = `Error: ${redactedMessage}\n`;
    if (redactedStack) {
      text += `\nStack:\n${redactedStack}\n`;
    }
    if (componentStack) {
      text += `\nComponent Stack:\n${componentStack}\n`;
    }

    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: clipboard API not available in all contexts
      console.warn('Clipboard API not available');
    }
  };

  private toggleComponentStack = (): void => {
    this.setState((prev) => ({ showComponentStack: !prev.showComponentStack }));
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const { error, errorId, componentStack, showComponentStack, copied } = this.state;
      const redactedMessage = error ? redactWalletAddresses(error.message || 'Unknown error') : '';
      const ctx = this.props.context ?? 'generic';
      const contextActions = getContextActions(ctx, this.props.onRecoveryAction);

      return (
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-red-300">Something went wrong</h1>
            <p className="text-sm text-red-100/90 mt-3">
              An unexpected error occurred. You can try again or return to the dashboard.
            </p>

            <div className="mt-4 p-3 rounded bg-black/30 border border-white/5">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Error Reference</p>
              <p className="text-sm font-mono text-red-200 mt-1">{errorId || 'GENERATING...'}</p>
            </div>

            {error ? (
              <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 border border-red-500/20 p-3 text-xs text-red-100 whitespace-pre-wrap break-words">
                {redactedMessage}
              </pre>
            ) : null}

            {componentStack ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={this.toggleComponentStack}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors"
                >
                  {showComponentStack ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  Component Stack
                </button>
                {showComponentStack && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 border border-white/5 p-3 text-xs text-gray-400 whitespace-pre-wrap break-words font-mono">
                    {componentStack}
                  </pre>
                )}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={this.handleTryAgain}
                className="min-h-[44px] flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-colors"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="min-h-[44px] flex-1 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-bold border border-white/10 transition-colors"
              >
                Go Home
              </button>
            </div>

            {contextActions.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-bold">Recovery Options</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  {contextActions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={action.handler}
                      className="min-h-[44px] flex-1 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium border border-white/10 transition-colors"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={this.handleCopyError}
                className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium border border-white/10 transition-colors"
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied!' : 'Copy Error'}
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium border border-white/10 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
