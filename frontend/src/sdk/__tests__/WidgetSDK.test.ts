/**
 * Widget SDK Tests
 * Template for testing widget SDK functionality
 */

import { WidgetSDK, createWidgetSDK, WidgetUtils } from '../WidgetSDK';
import type { WidgetPermissions } from '../../types/widget';

describe('WidgetSDK', () => {
  let sdk: WidgetSDK;
  let mockPostMessage: jest.Mock;

  beforeEach(() => {
    // Mock window.postMessage
    mockPostMessage = jest.fn();
    window.parent.postMessage = mockPostMessage;

    // Create SDK instance
    const permissions: WidgetPermissions = {
      network: true,
      storage: true,
      wallet: false,
      notifications: false,
    };
    sdk = new WidgetSDK('test-widget', permissions);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with correct widget ID', () => {
      expect(sdk).toBeDefined();
      expect((sdk as any).widgetId).toBe('test-widget');
    });

    it('should initialize with correct permissions', () => {
      expect((sdk as any).permissions.network).toBe(true);
      expect((sdk as any).permissions.storage).toBe(true);
      expect((sdk as any).permissions.wallet).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should request configuration', async () => {
      const configPromise = sdk.getConfig();

      // Simulate response
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            widgetId: 'test-widget',
            type: 'config-response',
            payload: { theme: 'dark' },
          },
        })
      );

      const config = await configPromise;
      expect(config).toEqual({ theme: 'dark' });
    });

    it('should set configuration', async () => {
      await sdk.setConfig({ theme: 'light' });

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          widgetId: 'test-widget',
          type: 'config',
          payload: { theme: 'light' },
        }),
        '*'
      );
    });
  });

  describe('Data Access', () => {
    it('should fetch data with network permission', async () => {
      const dataPromise = sdk.getData('vault-stats');

      // Simulate response
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            widgetId: 'test-widget',
            type: 'data-response',
            payload: { balance: 1000 },
          },
        })
      );

      const data = await dataPromise;
      expect(data).toEqual({ balance: 1000 });
    });

    it('should reject data request without network permission', async () => {
      const noNetworkSDK = new WidgetSDK('test-widget', { network: false });

      await expect(noNetworkSDK.getData('vault-stats')).rejects.toThrow(
        'Network permission not granted'
      );
    });
  });

  describe('Notifications', () => {
    it('should send notification with permission', async () => {
      const notificationSDK = new WidgetSDK('test-widget', {
        notifications: true,
      });

      await notificationSDK.sendNotification('Test message');

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action',
          payload: {
            action: 'notify',
            message: 'Test message',
          },
        }),
        '*'
      );
    });

    it('should reject notification without permission', async () => {
      await expect(sdk.sendNotification('Test')).rejects.toThrow(
        'Notification permission not granted'
      );
    });
  });

  describe('Permissions', () => {
    it('should request additional permission', async () => {
      const permissionPromise = sdk.requestPermission('wallet');

      // Simulate response
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            widgetId: 'test-widget',
            type: 'permission-response',
            payload: true,
          },
        })
      );

      const granted = await permissionPromise;
      expect(granted).toBe(true);
    });
  });

  describe('Events', () => {
    it('should register event handler', () => {
      const handler = jest.fn();
      sdk.on('test-event', handler);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            widgetId: 'test-widget',
            type: 'test-event',
            payload: { data: 'test' },
          },
        })
      );

      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should emit custom events', () => {
      sdk.emit('custom-event', { action: 'test' });

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action',
          payload: {
            event: 'custom-event',
            data: { action: 'test' },
          },
        }),
        '*'
      );
    });
  });
});

describe('createWidgetSDK', () => {
  it('should create SDK instance', () => {
    const sdk = createWidgetSDK('test-widget', { network: true });
    expect(sdk).toBeInstanceOf(WidgetSDK);
  });
});

describe('WidgetUtils', () => {
  describe('validateManifest', () => {
    it('should validate correct manifest', () => {
      const manifest = {
        metadata: {
          id: 'test-widget',
          name: 'Test Widget',
          version: '1.0.0',
        },
        entryPoint: 'https://example.com/widget.html',
      };

      expect(WidgetUtils.validateManifest(manifest)).toBe(true);
    });

    it('should reject invalid manifest', () => {
      const manifest = {
        metadata: {
          name: 'Test Widget',
        },
      };

      expect(WidgetUtils.validateManifest(manifest)).toBe(false);
    });
  });

  describe('sanitizeHTML', () => {
    it('should sanitize HTML', () => {
      const html = '<script>alert("xss")</script>';
      const sanitized = WidgetUtils.sanitizeHTML(html);
      expect(sanitized).not.toContain('<script>');
    });
  });

  describe('formatDate', () => {
    it('should format date', () => {
      const date = new Date('2024-02-24');
      const formatted = WidgetUtils.formatDate(date);
      expect(formatted).toMatch(/2\/24\/2024/);
    });
  });

  describe('debounce', () => {
    jest.useFakeTimers();

    it('should debounce function calls', () => {
      const fn = jest.fn();
      const debounced = WidgetUtils.debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    jest.useRealTimers();
  });
});

describe('Widget Integration', () => {
  it('should handle complete widget lifecycle', async () => {
    const sdk = createWidgetSDK('test-widget', {
      network: true,
      notifications: true,
    });

    // Initialize
    const configPromise = sdk.getConfig();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          widgetId: 'test-widget',
          type: 'config-response',
          payload: { theme: 'dark' },
        },
      })
    );
    const config = await configPromise;
    expect(config.theme).toBe('dark');

    // Fetch data
    const dataPromise = sdk.getData('vault-stats');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          widgetId: 'test-widget',
          type: 'data-response',
          payload: { balance: 1000 },
        },
      })
    );
    const data = await dataPromise;
    expect(data.balance).toBe(1000);

    // Send notification
    await sdk.sendNotification('Widget loaded');
    expect(window.parent.postMessage).toHaveBeenCalled();
  });
});
