/**
 * DashboardErrorBoundary
 * Wraps individual dashboard widgets so one failing widget
 * doesn't crash the entire dashboard.
 */
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  widgetTitle?: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[DashboardErrorBoundary] Widget "${this.props.widgetTitle}" crashed:`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[120px] bg-red-500/5 border border-red-500/20 rounded-lg p-4 text-center">
          <AlertTriangle size={24} className="text-red-400 mb-2" />
          <p className="text-sm font-semibold text-red-300 mb-1">
            {this.props.widgetTitle ?? 'Widget'} failed to render
          </p>
          <p className="text-xs text-red-400/70 mb-3 max-w-[200px] truncate">
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default DashboardErrorBoundary;
