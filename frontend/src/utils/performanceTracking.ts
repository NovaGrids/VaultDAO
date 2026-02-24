import { onCLS, onFCP, onFID, onLCP, onTTFB } from 'web-vitals';
import type { Metric } from 'web-vitals';

export interface PerformanceMetrics {
  lcp?: number;
  fid?: number;
  cls?: number;
  ttfb?: number;
  fcp?: number;
  navigationTiming?: PerformanceNavigationTiming;
  resourceTimings?: PerformanceResourceTiming[];
  memoryUsage?: MemoryMetrics;
  slowQueries: SlowQuery[];
  bundleSize?: BundleMetrics;
}

export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  percentageUsed: number;
}

export interface SlowQuery {
  name: string;
  duration: number;
  timestamp: number;
  type: 'api' | 'database' | 'computation';
}

export interface BundleMetrics {
  totalSize: number;
  gzipSize: number;
  chunks: ChunkMetric[];
}

export interface ChunkMetric {
  name: string;
  size: number;
  gzipSize: number;
}

class PerformanceTracker {
  private metrics: PerformanceMetrics = {
    slowQueries: [],
  };
  private slowQueryThreshold = 1000; // 1 second
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null;
  private memorySnapshots: MemoryMetrics[] = [];
  private observers: Map<string, PerformanceObserver> = new Map();

  constructor() {
    this.initializeWebVitals();
    this.initializeResourceTiming();
    this.initializeMemoryMonitoring();
  }

  private initializeWebVitals(): void {
    onLCP((metric: Metric) => {
      this.metrics.lcp = metric.value;
      this.reportMetric('LCP', metric.value);
    });

    onFID((metric: Metric) => {
      this.metrics.fid = metric.value;
      this.reportMetric('FID', metric.value);
    });

    onCLS((metric: Metric) => {
      this.metrics.cls = metric.value;
      this.reportMetric('CLS', metric.value);
    });

    onTTFB((metric: Metric) => {
      this.metrics.ttfb = metric.value;
      this.reportMetric('TTFB', metric.value);
    });

    onFCP((metric: Metric) => {
      this.metrics.fcp = metric.value;
      this.reportMetric('FCP', metric.value);
    });
  }

  private initializeResourceTiming(): void {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          this.metrics.resourceTimings = entries as PerformanceResourceTiming[];
        });
        observer.observe({ entryTypes: ['resource', 'navigation'] });
        this.observers.set('resource', observer);
      } catch (e) {
        console.warn('PerformanceObserver not supported for resources', e);
      }
    }
  }

  private initializeMemoryMonitoring(): void {
    const perf = performance as unknown as Record<string, unknown>;
    if (perf.memory) {
      this.memoryCheckInterval = setInterval(() => {
        const memory = this.getMemoryMetrics();
        this.memorySnapshots.push(memory);
        this.metrics.memoryUsage = memory;

        // Keep only last 60 snapshots (1 minute at 1 snapshot/second)
        if (this.memorySnapshots.length > 60) {
          this.memorySnapshots.shift();
        }

        this.detectMemoryLeaks();
      }, 1000);
    }
  }

  private getMemoryMetrics(): MemoryMetrics {
    const perf = performance as unknown as Record<string, unknown>;
    const memory = perf.memory;
    if (!memory) {
      return {
        usedJSHeapSize: 0,
        totalJSHeapSize: 0,
        jsHeapSizeLimit: 0,
        percentageUsed: 0,
      };
    }

    const memObj = memory as Record<string, number>;
    return {
      usedJSHeapSize: memObj.usedJSHeapSize,
      totalJSHeapSize: memObj.totalJSHeapSize,
      jsHeapSizeLimit: memObj.jsHeapSizeLimit,
      percentageUsed: (memObj.usedJSHeapSize / memObj.jsHeapSizeLimit) * 100,
    };
  }

  private detectMemoryLeaks(): void {
    if (this.memorySnapshots.length < 10) return;

    const recent = this.memorySnapshots.slice(-10);
    const trend = recent.map((m) => m.usedJSHeapSize);
    const isIncreasing = trend.every((val, i) => i === 0 || val >= trend[i - 1]);

    if (isIncreasing) {
      const increase = trend[trend.length - 1] - trend[0];
      const percentIncrease = (increase / trend[0]) * 100;

      if (percentIncrease > 20) {
        console.warn(
          `Potential memory leak detected: ${percentIncrease.toFixed(2)}% increase in 10 seconds`
        );
      }
    }
  }

  trackSlowQuery(name: string, duration: number, type: 'api' | 'database' | 'computation' = 'api'): void {
    if (duration > this.slowQueryThreshold) {
      const query: SlowQuery = {
        name,
        duration,
        timestamp: Date.now(),
        type,
      };
      this.metrics.slowQueries.push(query);

      // Keep only last 100 slow queries
      if (this.metrics.slowQueries.length > 100) {
        this.metrics.slowQueries.shift();
      }

      console.warn(`Slow ${type}: ${name} took ${duration}ms`);
    }
  }

  getMetrics(): PerformanceMetrics {
    return {
      ...this.metrics,
      navigationTiming: performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming,
    };
  }

  getRecommendations(): string[] {
    const recommendations: string[] = [];
    const metrics = this.getMetrics();

    // LCP recommendations
    if (metrics.lcp && metrics.lcp > 2500) {
      recommendations.push('LCP is high (>2.5s). Consider optimizing images and lazy loading.');
    }

    // FID recommendations
    if (metrics.fid && metrics.fid > 100) {
      recommendations.push('FID is high (>100ms). Consider code splitting and reducing main thread work.');
    }

    // CLS recommendations
    if (metrics.cls && metrics.cls > 0.1) {
      recommendations.push('CLS is high (>0.1). Ensure images have dimensions and avoid layout shifts.');
    }

    // Memory recommendations
    if (metrics.memoryUsage && metrics.memoryUsage.percentageUsed > 80) {
      recommendations.push('Memory usage is high (>80%). Consider optimizing data structures and cleanup.');
    }

    // Slow queries
    if (metrics.slowQueries.length > 10) {
      recommendations.push(`${metrics.slowQueries.length} slow queries detected. Review API calls and database queries.`);
    }

    // Resource timing
    if (metrics.resourceTimings) {
      const largeResources = metrics.resourceTimings.filter((r) => r.transferSize > 1000000);
      if (largeResources.length > 0) {
        recommendations.push(`${largeResources.length} resources >1MB detected. Consider compression and code splitting.`);
      }
    }

    return recommendations;
  }

  private reportMetric(name: string, value: number): void {
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;
      if (win.gtag) {
        const gtag = win.gtag as (event: string, name: string, data: Record<string, unknown>) => void;
        gtag('event', `web_vital_${name.toLowerCase()}`, {
          value: Math.round(value),
          event_category: 'web_vitals',
        });
      }
    }
  }

  destroy(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
    this.observers.forEach((observer) => observer.disconnect());
  }
}

export const performanceTracker = new PerformanceTracker();
