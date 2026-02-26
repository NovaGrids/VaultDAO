import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // Keep this in development to help debugging rendering/runtime failures.
      console.error('ErrorBoundary caught an error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }
  }

  private handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleReloadPage = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-red-300">Something went wrong</h1>
            <p className="text-sm text-red-100/90 mt-3">
              An unexpected error occurred. You can try rendering again or reload the page.
            </p>

            {import.meta.env.DEV && this.state.error ? (
              <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 border border-red-500/20 p-3 text-xs text-red-100 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            ) : null}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={this.handleTryAgain}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReloadPage}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium"
              >
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
