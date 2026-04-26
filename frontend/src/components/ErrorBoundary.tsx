import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordError } from '../utils/errorAnalytics';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorId: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorId: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    let errorId = '';
    try {
      errorId = recordError({
        code: 'REACT_ERROR_BOUNDARY',
        message: error.message || 'Unknown error',
        stack: error.stack,
        context: errorInfo.componentStack || undefined,
      });
      this.setState({ errorId });
    } catch (reportingError) {
      console.error('Failed to report error to analytics:', reportingError);
    }

    if ((import.meta as any).env?.DEV) {
      console.error('ErrorBoundary caught an error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }
  }

  private handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  private handleGoHome = (): void => {
    window.location.href = '/';
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-red-300">Something went wrong</h1>
            <p className="text-sm text-red-100/90 mt-3">
              An unexpected error occurred. You can try again or return to the dashboard.
            </p>

            <div className="mt-4 p-3 rounded bg-black/30 border border-white/5">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Error Reference</p>
              <p className="text-sm font-mono text-red-200 mt-1">{this.state.errorId || 'GENERATING...'}</p>
            </div>

            {import.meta.env.DEV && this.state.error ? (
              <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 border border-red-500/20 p-3 text-xs text-red-100 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
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
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
