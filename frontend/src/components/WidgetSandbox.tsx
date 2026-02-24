import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Shield, X } from 'lucide-react';
import type { InstalledWidget, WidgetMessage } from '../types/widget';

interface WidgetSandboxProps {
  widget: InstalledWidget;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

const WidgetSandbox: React.FC<WidgetSandboxProps> = ({ widget, onLoad, onError }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setupMessageHandler();
    loadWidget();
  }, [widget]);

  const setupMessageHandler = () => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.widgetId !== widget.id) return;

      const message: WidgetMessage = event.data;

      switch (message.type) {
        case 'init':
          setLoading(false);
          onLoad?.();
          break;

        case 'config':
          handleConfigRequest(message.payload);
          break;

        case 'data':
          handleDataRequest(message.payload);
          break;

        case 'action':
          handleAction(message.payload);
          break;

        case 'error':
          handleError(message.payload);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  };

  const loadWidget = () => {
    if (!iframeRef.current) return;

    // Create sandboxed HTML content
    const html = createSandboxedHTML(widget);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    iframeRef.current.src = url;

    // Cleanup
    return () => URL.revokeObjectURL(url);
  };

  const createSandboxedHTML = (widget: InstalledWidget): string => {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: system-ui, -apple-system, sans-serif;
              background: transparent;
              color: #fff;
              padding: 1rem;
            }
          </style>
        </head>
        <body>
          <div id="widget-root"></div>
          <script>
            // Widget SDK initialization
            const widgetSDK = {
              widgetId: '${widget.id}',
              permissions: ${JSON.stringify(widget.permissions)},
              
              postMessage: function(type, payload) {
                window.parent.postMessage({
                  widgetId: this.widgetId,
                  type: type,
                  payload: payload
                }, '*');
              },
              
              getConfig: function() {
                return new Promise((resolve) => {
                  window.addEventListener('message', function handler(e) {
                    if (e.data.type === 'config-response') {
                      window.removeEventListener('message', handler);
                      resolve(e.data.payload);
                    }
                  });
                  this.postMessage('config', null);
                });
              },
              
              getData: function(query) {
                if (!this.permissions.network) {
                  return Promise.reject(new Error('Network permission denied'));
                }
                return new Promise((resolve) => {
                  window.addEventListener('message', function handler(e) {
                    if (e.data.type === 'data-response') {
                      window.removeEventListener('message', handler);
                      resolve(e.data.payload);
                    }
                  });
                  this.postMessage('data', { query });
                });
              },
              
              notify: function(message) {
                if (!this.permissions.notifications) {
                  throw new Error('Notification permission denied');
                }
                this.postMessage('action', { action: 'notify', message });
              }
            };
            
            // Initialize widget
            try {
              widgetSDK.postMessage('init', { ready: true });
              
              // Sample widget implementation
              const root = document.getElementById('widget-root');
              root.innerHTML = \`
                <div style="padding: 1rem; background: rgba(255,255,255,0.05); border-radius: 0.5rem;">
                  <h3 style="margin-bottom: 0.5rem;">${widget.metadata.name}</h3>
                  <p style="color: #9ca3af; font-size: 0.875rem;">${widget.metadata.description}</p>
                  <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(139,92,246,0.1); border-radius: 0.375rem; border: 1px solid rgba(139,92,246,0.3);">
                    <p style="font-size: 0.875rem;">Widget is running in sandboxed environment</p>
                  </div>
                </div>
              \`;
            } catch (error) {
              widgetSDK.postMessage('error', { message: error.message });
            }
          </script>
        </body>
      </html>
    `;
  };

  const handleConfigRequest = (payload: any) => {
    if (!iframeRef.current?.contentWindow) return;

    iframeRef.current.contentWindow.postMessage({
      type: 'config-response',
      payload: widget.settings,
    }, '*');
  };

  const handleDataRequest = async (payload: any) => {
    if (!widget.permissions.network) {
      handleError({ message: 'Network permission denied' });
      return;
    }

    try {
      // Simulate data fetching - in production, this would call actual APIs
      const data = await fetchWidgetData(payload.query);
      
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'data-response',
          payload: data,
        }, '*');
      }
    } catch (error) {
      handleError({ message: (error as Error).message });
    }
  };

  const handleAction = (payload: any) => {
    switch (payload.action) {
      case 'notify':
        if (widget.permissions.notifications) {
          // Trigger notification
          console.log('Widget notification:', payload.message);
        }
        break;

      case 'request-permission':
        // Handle permission request
        console.log('Permission requested:', payload.permission);
        break;
    }
  };

  const handleError = (payload: any) => {
    const errorMsg = payload.message || 'Widget error occurred';
    setError(errorMsg);
    onError?.(new Error(errorMsg));
  };

  const fetchWidgetData = async (query: string): Promise<any> => {
    // Mock data fetching - replace with actual implementation
    return {
      timestamp: new Date().toISOString(),
      data: [],
    };
  };

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-red-400 mb-1">
              Widget Error: {widget.metadata.name}
            </h4>
            <p className="text-sm text-red-300">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-1 hover:bg-red-800/50 rounded text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      {/* Widget Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-purple-400" />
          <span className="text-sm text-gray-300">{widget.metadata.name}</span>
          <span className="text-xs text-gray-500">v{widget.metadata.version}</span>
        </div>
        {loading && (
          <span className="text-xs text-gray-500">Loading...</span>
        )}
      </div>

      {/* Sandboxed iframe */}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        className="w-full h-64 border-0"
        title={widget.metadata.name}
      />
    </div>
  );
};

export default WidgetSandbox;
