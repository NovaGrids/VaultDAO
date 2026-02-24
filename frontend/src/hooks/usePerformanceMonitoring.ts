import { useEffect, useRef } from 'react';
import { performanceTracker } from '../utils/performanceTracking';

/**
 * Hook to monitor component render performance
 */
export function usePerformanceMonitoring(componentName: string): void {
  const renderTimeRef = useRef<number>(0);
  const renderCountRef = useRef<number>(0);

  useEffect(() => {
    renderTimeRef.current = performance.now();
    renderCountRef.current += 1;

    return () => {
      const renderDuration = performance.now() - renderTimeRef.current;

      // Log slow renders (> 16ms, which is roughly 60fps)
      if (renderDuration > 16) {
        console.warn(
          `Slow render detected in ${componentName}: ${renderDuration.toFixed(2)}ms (render #${renderCountRef.current})`
        );
      }
    };
  });
}

/**
 * Hook to track API call performance
 */
export function useApiTracking(
  apiCall: () => Promise<unknown>,
  dependencies: unknown[] = []
): void {
  useEffect(() => {
    const startTime = performance.now();

    apiCall()
      .then(() => {
        const duration = performance.now() - startTime;
        if (duration > 1000) {
          performanceTracker.trackSlowQuery(
            `API Call in component`,
            duration,
            'api'
          );
        }
      })
      .catch((error: unknown) => {
        const duration = performance.now() - startTime;
        performanceTracker.trackSlowQuery(
          `API Call in component (FAILED)`,
          duration,
          'api'
        );
        console.error('API call failed:', error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}

/**
 * Hook to measure memory usage
 */
export function useMemoryMonitoring(componentName: string): void {
  useEffect(() => {
    const perf = performance as unknown as Record<string, unknown>;
    if (!perf.memory) {
      return;
    }

    const memory = perf.memory as Record<string, number>;
    const initialMemory = memory.usedJSHeapSize;

    return () => {
      const finalMemory = (performance as unknown as Record<string, unknown>).memory as Record<string, number>;
      const memoryDelta = finalMemory.usedJSHeapSize - initialMemory;

      if (Math.abs(memoryDelta) > 1000000) {
        // More than 1MB change
        console.log(
          `Memory change in ${componentName}: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`
        );
      }
    };
  }, [componentName]);
}
