import { useEffect, useRef } from 'react';
import { onCLS, onFID, onFCP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { performanceTracker, type PerformanceMetrics } from '../utils/performanceTracking';
import { recordError } from '../utils/errorAnalytics';

interface PerformanceMonitorProps {
  onMetricsUpdate?: (metrics: PerformanceMetrics) => void;
  enableConsoleLogging?: boolean;
}

/**
 * Report a web-vitals metric to the error analytics infrastructure
 * using the PERF_METRIC code for easy filtering.
 */
function reportWebVital(metric: Metric): void {
  recordError({
    code: 'PERF_METRIC',
    message: `${metric.name}: ${metric.value.toFixed(2)} (rating: ${metric.rating})`,
    context: JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
    }),
  });
}

export default function PerformanceMonitor({
  onMetricsUpdate,
  enableConsoleLogging = false,
}: PerformanceMonitorProps) {
  const metricsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isReportingEnabled = (import.meta as any).env?.VITE_ERROR_REPORTING_ENABLED;

    // Register web-vitals observers when reporting is enabled
    if (isReportingEnabled) {
      onCLS(reportWebVital);
      onFID(reportWebVital);
      onFCP(reportWebVital);
      onLCP(reportWebVital);
      onTTFB(reportWebVital);
    }

    // Track page visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (enableConsoleLogging) {
          console.log('Page hidden, pausing performance tracking');
        }
      } else {
        if (enableConsoleLogging) {
          console.log('Page visible, resuming performance tracking');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic metrics collection
    metricsIntervalRef.current = setInterval(() => {
      const metrics = performanceTracker.getMetrics();
      onMetricsUpdate?.(metrics);

      if (enableConsoleLogging) {
        console.log('Performance Metrics:', {
          lcp: metrics.lcp?.toFixed(2),
          fid: metrics.fid?.toFixed(2),
          cls: metrics.cls?.toFixed(2),
          ttfb: metrics.ttfb?.toFixed(2),
          fcp: metrics.fcp?.toFixed(2),
          memory: metrics.memoryUsage?.percentageUsed.toFixed(2) + '%',
          slowQueries: metrics.slowQueries.length,
        });
      }
    }, 5000);

    // Track navigation timing
    window.addEventListener('load', () => {
      const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navigationTiming && enableConsoleLogging) {
        console.log('Navigation Timing:', {
          domContentLoaded: navigationTiming.domContentLoadedEventEnd - navigationTiming.domContentLoadedEventStart,
          loadComplete: navigationTiming.loadEventEnd - navigationTiming.loadEventStart,
          domInteractive: navigationTiming.domInteractive - navigationTiming.fetchStart,
        });
      }
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (metricsIntervalRef.current) {
        clearInterval(metricsIntervalRef.current);
      }
    };
  }, [onMetricsUpdate, enableConsoleLogging]);

  return null;
}
