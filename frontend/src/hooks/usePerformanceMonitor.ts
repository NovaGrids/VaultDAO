import { useEffect, useRef } from 'react';

interface PerformanceMetrics {
  renderTime: number;
  memoryUsage: number;
  fcp?: number;
  lcp?: number;
}

interface PerformanceObserverCallback {
  (metrics: PerformanceMetrics): void;
}

export const usePerformanceMonitor = (
  componentName: string,
  callback?: PerformanceObserverCallback
) => {
  const startTimeRef = useRef<number>(0);
  const renderTimeRef = useRef<number>(0);

  // Measure render time
  useEffect(() => {
    startTimeRef.current = performance.now();

    return () => {
      const endTime = performance.now();
      renderTimeRef.current = endTime - startTimeRef.current;

      const metrics: PerformanceMetrics = {
        renderTime: renderTimeRef.current,
        memoryUsage: (performance as any).memory?.usedJSHeapSize || 0,
      };

      if (callback) {
        callback(metrics);
      }

      // Log in development
      if (import.meta.env.DEV) {
        console.debug(`[${componentName}] Render Time: ${renderTimeRef.current.toFixed(2)}ms`, {
          memoryUsage: `${(metrics.memoryUsage / 1048576).toFixed(2)}MB`,
        });
      }
    };
  }, [componentName, callback]);

  // Track Web Vitals (FCP, LCP)
  useEffect(() => {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            const fcp = entry.startTime;
            if (import.meta.env.DEV) {
              console.debug(`[${componentName}] FCP: ${fcp.toFixed(2)}ms`);
            }
          }
          if ((entry as any).name === 'largest-contentful-paint') {
            const lcp = (entry as any).startTime;
            if (import.meta.env.DEV) {
              console.debug(`[${componentName}] LCP: ${lcp.toFixed(2)}ms`);
            }
          }
        }
      });

      observer.observe({ type: 'paint', buffered: true });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });

      return () => observer.disconnect();
    } catch (e) {
      // Performance Observer not supported
    }
  }, [componentName]);

  return renderTimeRef;
};

// Global performance monitoring utility
export const monitorProposalListPerformance = () => {
  const startTime = performance.now();
  
  return {
    markRenderStart: () => performance.mark('proposal-list-render-start'),
    markRenderEnd: () => performance.mark('proposal-list-render-end'),
    measure: () => {
      try {
        performance.measure('proposal-list-render', 'proposal-list-render-start', 'proposal-list-render-end');
        const measure = performance.getEntriesByName('proposal-list-render')[0];
        return (measure as PerformanceMeasure).duration;
      } catch (e) {
        return performance.now() - startTime;
      }
    },
  };
};
