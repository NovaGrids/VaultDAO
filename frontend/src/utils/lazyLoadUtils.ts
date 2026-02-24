import { lazy } from 'react';
import type { ComponentType } from 'react';

/**
 * Lazy load a component with a fallback UI
 * Useful for code splitting large components
 */
export function lazyLoadComponent<P extends object>(
  importFunc: () => Promise<{ default: ComponentType<P> }>,
  componentName: string
): ComponentType<P> {
  return lazy(async () => {
    try {
      return await importFunc();
    } catch (error) {
      console.error(`Failed to load component: ${componentName}`, error);
      throw error;
    }
  });
}

/**
 * Preload a component before it's needed
 * Useful for improving perceived performance
 */
export function preloadComponent(
  importFunc: () => Promise<{ default: ComponentType<unknown> }>
): void {
  if (typeof window !== 'undefined') {
    // Use requestIdleCallback if available, otherwise use setTimeout
    const callback = () => {
      importFunc().catch((error: unknown) => {
        console.warn('Failed to preload component:', error);
      });
    };

    const win = window as unknown as Record<string, unknown>;
    if ('requestIdleCallback' in win) {
      const requestIdleCallback = win.requestIdleCallback as (callback: () => void, options: Record<string, number>) => void;
      requestIdleCallback(callback, { timeout: 2000 });
    } else {
      setTimeout(callback, 1000);
    }
  }
}

/**
 * Intersection Observer based lazy loading for images
 */
export function setupImageLazyLoading(): void {
  if (!('IntersectionObserver' in window)) {
    // Fallback for older browsers
    const images = document.querySelectorAll('img[data-src]');
    images.forEach((img) => {
      const src = (img as HTMLImageElement).getAttribute('data-src');
      if (src) {
        (img as HTMLImageElement).src = src;
      }
    });
    return;
  }

  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target as HTMLImageElement;
        const src = img.getAttribute('data-src');
        if (src) {
          img.src = src;
          img.removeAttribute('data-src');
          observer.unobserve(img);
        }
      }
    });
  });

  document.querySelectorAll('img[data-src]').forEach((img) => {
    imageObserver.observe(img);
  });
}

/**
 * Measure component render time
 */
export function measureComponentRender(componentName: string): () => void {
  const startTime = performance.now();

  return () => {
    const endTime = performance.now();
    const duration = endTime - startTime;
    console.log(`${componentName} rendered in ${duration.toFixed(2)}ms`);
  };
}
