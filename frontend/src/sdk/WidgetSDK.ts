/**
 * Widget SDK
 * Provides a stable public API for third-party widget development.
 * This class is intended to be used by widget developers within their sandboxed environment.
 */

import type { 
  WidgetAPI, 
  WidgetMessage, 
  WidgetPermissions, 
  WidgetEventType 
} from '../types/widget';

export class WidgetSDK implements WidgetAPI {
  private widgetId: string;
  private permissions: WidgetPermissions;
  private messageHandlers: Map<string, (data: unknown) => void> = new Map();
  private eventHandlers: Map<WidgetEventType, Set<(data: unknown) => void>> = new Map();
  private pendingRequests: Map<string, { resolve: (data: any) => void; reject: (reason: unknown) => void }> = new Map();

  /**
   * @param widgetId - Unique identifier for the widget
   * @param permissions - Permissions granted to the widget
   */
  constructor(widgetId: string, permissions: WidgetPermissions) {
    this.widgetId = widgetId;
    this.permissions = permissions;
    this.setupMessageListener();
  }

  /**
   * Sets up the listener for messages from the host application.
   * @private
   */
  private setupMessageListener() {
    window.addEventListener('message', (event) => {
      const message: WidgetMessage = event.data;
      
      // Ensure the message is intended for this widget
      if (message.widgetId !== this.widgetId && !message.callId) return;

      switch (message.type) {
        case 'response':
          this.handleResponse(message);
          break;
        case 'event':
          this.handleEvent(message);
          break;
        case 'error':
          console.error(`[WidgetSDK:${this.widgetId}] Error:`, message.payload);
          break;
      }
    });
  }

  /**
   * Handles response messages for pending requests.
   * @private
   */
  private handleResponse(message: WidgetMessage) {
    if (!message.callId) return;
    const pending = this.pendingRequests.get(message.callId);
    if (pending) {
      pending.resolve(message.payload);
      this.pendingRequests.delete(message.callId);
    }
  }

  /**
   * Handles incoming events from the host.
   * @private
   */
  private handleEvent(message: WidgetMessage) {
    const payload = message.payload as { eventType: WidgetEventType; data: unknown };
    const { eventType, data } = payload;
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  /**
   * Sends a message to the host application.
   * @private
   */
  private postMessage(type: WidgetMessage['type'], payload: unknown): string {
    const callId = Math.random().toString(36).substring(2, 11);
    window.parent.postMessage({
      widgetId: this.widgetId,
      type,
      payload,
      callId,
    }, '*');
    return callId;
  }

  /**
   * Sends a request to the host and waits for a response.
   * @private
   */
  private async request<T>(type: WidgetMessage['type'], payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const callId = this.postMessage(type, payload);
      this.pendingRequests.set(callId, { resolve, reject });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(callId)) {
          this.pendingRequests.delete(callId);
          reject(new Error(`Request timed out: ${type}`));
        }
      }, 30000);
    });
  }

  /**
   * Gets the current widget configuration.
   * @returns Promise resolving to the configuration object.
   */
  async getConfig(): Promise<Record<string, unknown>> {
    return this.request('config', { action: 'get' });
  }

  /**
   * Updates the widget configuration.
   * @param config - The new configuration object.
   */
  async setConfig(config: Record<string, unknown>): Promise<void> {
    return this.request('config', { action: 'set', config });
  }

  /**
   * Fetches proposals from the vault.
   * @param filter - Optional filter parameters.
   * @returns Promise resolving to an array of proposals.
   */
  async getProposals(filter?: Record<string, unknown>): Promise<unknown[]> {
    return this.request('data', { action: 'getProposals', filter });
  }

  /**
   * Gets the current vault configuration.
   * @returns Promise resolving to the vault configuration.
   */
  async getVaultConfig(): Promise<unknown> {
    return this.request('data', { action: 'getVaultConfig' });
  }

  /**
   * Shows a toast notification in the host application.
   * @param message - The message to display.
   * @param type - The type of notification (success, error, info, warning).
   */
  async showToast(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): Promise<void> {
    if (!this.permissions.notifications) {
      throw new Error('Notification permission not granted');
    }
    return this.request('action', { action: 'showToast', message, type });
  }

  /**
   * Navigates to a specific path within the host application.
   * @param path - The relative path to navigate to.
   */
  async navigate(path: string): Promise<void> {
    return this.request('action', { action: 'navigate', path });
  }

  /**
   * Requests a specific permission from the host.
   * @param permission - The permission to request.
   * @returns Promise resolving to true if granted, false otherwise.
   */
  async requestPermission(permission: keyof WidgetPermissions): Promise<boolean> {
    return this.request('action', { action: 'request-permission', permission });
  }

  /**
   * Subscribes to a vault event.
   * @param type - The event type to subscribe to.
   * @param handler - The callback function to execute when the event occurs.
   */
  onEvent(type: WidgetEventType, handler: (data: unknown) => void) {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
      // Notify host that we are listening to this event
      this.postMessage('action', { action: 'subscribe', eventType: type });
    }
    this.eventHandlers.get(type)!.add(handler);
  }

  /**
   * Unsubscribes from a vault event.
   * @param type - The event type.
   * @param handler - The handler to remove.
   */
  offEvent(type: WidgetEventType, handler: (data: unknown) => void) {
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(type);
        this.postMessage('action', { action: 'unsubscribe', eventType: type });
      }
    }
  }
}

/**
 * Factory function to create a new Widget SDK instance.
 * @param widgetId - Unique identifier for the widget.
 * @param permissions - Permissions granted to the widget.
 * @returns An instance of WidgetSDK.
 */
export function createWidgetSDK(widgetId: string, permissions: WidgetPermissions): WidgetSDK {
  return new WidgetSDK(widgetId, permissions);
}
