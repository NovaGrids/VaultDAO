/**
 * Widget SDK
 * Provides API for third-party widget development
 */

import type { WidgetAPI, WidgetMessage, WidgetPermissions } from '../types/widget';

export class WidgetSDK implements WidgetAPI {
  private widgetId: string;
  private permissions: WidgetPermissions;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(widgetId: string, permissions: WidgetPermissions) {
    this.widgetId = widgetId;
    this.permissions = permissions;
    this.setupMessageListener();
  }

  private setupMessageListener() {
    window.addEventListener('message', (event) => {
      if (event.data.widgetId === this.widgetId) {
        const handler = this.messageHandlers.get(event.data.type);
        if (handler) {
          handler(event.data.payload);
        }
      }
    });
  }

  private postMessage(message: WidgetMessage) {
    window.parent.postMessage({
      widgetId: this.widgetId,
      ...message,
    }, '*');
  }

  async getConfig(): Promise<Record<string, any>> {
    return new Promise((resolve) => {
      this.messageHandlers.set('config-response', resolve);
      this.postMessage({ type: 'config', payload: null });
    });
  }

  async setConfig(config: Record<string, any>): Promise<void> {
    this.postMessage({ type: 'config', payload: config });
  }

  async getData(query: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.permissions.network) {
        reject(new Error('Network permission not granted'));
        return;
      }

      this.messageHandlers.set('data-response', resolve);
      this.postMessage({ type: 'data', payload: { query } });
    });
  }

  async sendNotification(message: string): Promise<void> {
    if (!this.permissions.notifications) {
      throw new Error('Notification permission not granted');
    }

    this.postMessage({ type: 'action', payload: { action: 'notify', message } });
  }

  async requestPermission(permission: keyof WidgetPermissions): Promise<boolean> {
    return new Promise((resolve) => {
      this.messageHandlers.set('permission-response', resolve);
      this.postMessage({ type: 'action', payload: { action: 'request-permission', permission } });
    });
  }

  on(event: string, handler: (data: any) => void) {
    this.messageHandlers.set(event, handler);
  }

  emit(event: string, data: any) {
    this.postMessage({ type: 'action', payload: { event, data } });
  }
}

// Helper function to create widget SDK instance
export function createWidgetSDK(widgetId: string, permissions: WidgetPermissions): WidgetSDK {
  return new WidgetSDK(widgetId, permissions);
}

// Widget development utilities
export const WidgetUtils = {
  validateManifest: (manifest: any): boolean => {
    return !!(
      manifest.metadata?.id &&
      manifest.metadata?.name &&
      manifest.metadata?.version &&
      manifest.entryPoint
    );
  },

  sanitizeHTML: (html: string): string => {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  },

  formatDate: (date: string | Date): string => {
    return new Date(date).toLocaleDateString();
  },

  debounce: <T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },
};
