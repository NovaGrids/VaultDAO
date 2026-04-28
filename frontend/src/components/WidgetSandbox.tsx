import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Shield, X, Maximize2, Minimize2, ExternalLink } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useProposals } from '../hooks/useProposals';
import { useVaultContract } from '../hooks/useVaultContract';
import type { InstalledWidget, WidgetMessage, WidgetEventType } from '../types/widget';

interface WidgetSandboxProps {
  widget: InstalledWidget;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onRemove?: () => void;
}

/**
 * WidgetSandbox component
 * Renders a third-party widget in a secure iframe with a postMessage bridge.
 */
const WidgetSandbox: React.FC<WidgetSandboxProps> = ({ widget, onLoad, onError, onRemove }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeSubscriptions, setActiveSubscriptions] = useState<Set<WidgetEventType>>(new Set());

  const navigate = useNavigate();
  const { showToast } = useToast();
  const { proposals } = useProposals();
  const { getVaultConfig } = useVaultContract();

  // Handle messages from the widget
  const handleMessage = useCallback(async (event: MessageEvent) => {
    // Basic security check: ensure message is from our iframe
    if (event.source !== iframeRef.current?.contentWindow) return;

    const message: WidgetMessage = event.data;
    if (message.widgetId !== widget.id) return;

    const respond = (payload: unknown, type: WidgetMessage['type'] = 'response') => {
      iframeRef.current?.contentWindow?.postMessage({
        type,
        payload,
        callId: message.callId,
        widgetId: widget.id
      }, '*');
    };

    try {
      const payload = message.payload as Record<string, unknown>;
      switch (message.type) {
        case 'init':
          setLoading(false);
          onLoad?.();
          break;

        case 'config':
          if (payload.action === 'get') {
            respond(widget.settings);
          } else if (payload.action === 'set') {
            // In a real app, this would persist the settings
            console.log(`[Widget:${widget.id}] Saving config:`, payload.config);
            respond({ success: true });
          }
          break;

        case 'data':
          if (payload.action === 'getProposals') {
            respond(proposals);
          } else if (payload.action === 'getVaultConfig') {
            const config = await getVaultConfig();
            respond(config);
          }
          break;

        case 'action':
          handleWidgetAction(payload, respond);
          break;

        case 'error': {
          const errorMsg = (payload.message as string) || 'Unknown widget error';
          setError(errorMsg);
          onError?.(new Error(errorMsg));
          break;
        }
      }
    } catch (err) {
      console.error(`[Widget:${widget.id}] Error handling message:`, err);
      respond({ error: (err as Error).message }, 'error');
    }
  }, [widget, proposals, getVaultConfig, onLoad, onError]);

  const handleWidgetAction = (payload: Record<string, unknown>, respond: (data: unknown) => void) => {
    switch (payload.action) {
      case 'showToast':
        if (widget.permissions.notifications) {
          showToast(payload.message as string, (payload.type as any) || 'info');
          respond({ success: true });
        } else {
          respond({ error: 'Notification permission denied' });
        }
        break;

      case 'navigate':
        navigate(payload.path as string);
        respond({ success: true });
        break;

      case 'subscribe':
        setActiveSubscriptions(prev => new Set(prev).add(payload.eventType as WidgetEventType));
        respond({ success: true });
        break;

      case 'unsubscribe':
        setActiveSubscriptions(prev => {
          const next = new Set(prev);
          next.delete(payload.eventType as WidgetEventType);
          return next;
        });
        respond({ success: true });
        break;

      case 'request-permission':
        // Mock permission granting
        respond(true);
        break;
    }
  };

  // Watch for proposal changes to fire events
  useEffect(() => {
    if (activeSubscriptions.has('proposalCreated') && proposals.length > 0) {
      // In a real scenario, we'd only fire this for the *newest* proposal
      // For the sandbox demo, we'll just emit the latest one if it's new
      iframeRef.current?.contentWindow?.postMessage({
        type: 'event',
        payload: {
          eventType: 'proposalCreated',
          data: proposals[0]
        },
        widgetId: widget.id
      }, '*');
    }
  }, [proposals, activeSubscriptions, widget.id]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const loadWidget = () => {
    if (!iframeRef.current) return;
    
    // Injecting a base HTML with the widget's entry point script
    // In a production app, the entryPoint would be a URL to a JS file
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              margin: 0; 
              padding: 16px; 
              font-family: 'Inter', system-ui, -apple-system, sans-serif;
              color: #E2E8F0;
              background: transparent;
              overflow-x: hidden;
            }
            * { box-sizing: border-box; }
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #4B5563; border-radius: 3px; }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script type="module">
            // This is where the third-party widget code would be loaded.
            // For the demo, we'll simulate a widget that uses the SDK.
            
            console.log("[Widget] Starting initialization...");
            
            // Simulating a mini-SDK for the widget context
            window.parent.postMessage({ type: 'init', widgetId: '${widget.id}', payload: { ready: true } }, '*');
            
            const root = document.getElementById('root');
            root.innerHTML = \`
              <div style="background: rgba(31, 41, 55, 0.5); border: 1px solid rgba(75, 85, 99, 0.3); border-radius: 12px; padding: 20px; backdrop-filter: blur(8px);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                  <div style="width: 10px; height: 10px; background: #8B5CF6; border-radius: 50%; box-shadow: 0 0 10px #8B5CF6;"></div>
                  <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Widget API Demo</h3>
                </div>
                <p style="font-size: 13px; color: #9CA3AF; margin-bottom: 20px; line-height: 1.5;">
                  This widget is running in a secure sandbox. Click the button below to fetch proposals via the Vault SDK.
                </p>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                  <button id="fetchBtn" style="background: #3B82F6; color: white; border: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; transition: background 0.2s;">
                    Fetch Proposals
                  </button>
                  <button id="toastBtn" style="background: rgba(255,255,255,0.05); color: #F3F4F6; border: 1px solid rgba(255,255,255,0.1); padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer;">
                    Show Notification
                  </button>
                </div>
                <div id="output" style="margin-top: 20px; font-size: 12px; font-family: monospace; color: #10B981; max-height: 100px; overflow-y: auto;"></div>
              </div>
            \`;

            document.getElementById('fetchBtn').onclick = () => {
              const callId = Math.random().toString(36).substring(7);
              window.parent.postMessage({ 
                type: 'data', 
                widgetId: '${widget.id}', 
                payload: { action: 'getProposals' },
                callId 
              }, '*');
            };

            document.getElementById('toastBtn').onclick = () => {
              window.parent.postMessage({ 
                type: 'action', 
                widgetId: '${widget.id}', 
                payload: { action: 'showToast', message: 'Hello from Widget Sandbox!', type: 'success' }
              }, '*');
            };

            window.addEventListener('message', (e) => {
              if (e.data.type === 'response') {
                const output = document.getElementById('output');
                output.innerText = 'Received ' + (e.data.payload.length || 0) + ' proposals';
              }
              if (e.data.type === 'event') {
                const output = document.getElementById('output');
                output.innerText = 'Event: ' + e.data.payload.eventType;
              }
            });
          </script>
        </body>
      </html>
    `;
    
    const blob = new Blob([html], { type: 'text/html' });
    iframeRef.current.src = URL.createObjectURL(blob);
  };

  useEffect(() => {
    loadWidget();
  }, [widget.id]);

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-xl p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onRemove} className="text-red-400 hover:text-red-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-4 mb-3">
          <div className="bg-red-500/20 p-2 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-red-500" />
          </div>
          <h4 className="text-lg font-semibold text-red-400">Widget Failed</h4>
        </div>
        <p className="text-sm text-red-300 leading-relaxed">{error}</p>
        <button 
          onClick={() => { setError(null); loadWidget(); }}
          className="mt-4 text-xs font-medium uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
        >
          Try Restarting
        </button>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col bg-gray-900/40 border border-gray-800 rounded-xl transition-all duration-300 overflow-hidden ${isExpanded ? 'fixed inset-4 z-50' : 'h-full min-h-[300px]'}`}>
      {/* Widget Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900/60 border-b border-gray-800 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-white/5">
            <Shield className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white leading-tight">{widget.metadata.name}</h4>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">v{widget.metadata.version}</span>
              <span className="text-[10px] text-gray-400 font-medium">by {widget.metadata.author}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button 
            onClick={onRemove}
            className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
            title="Remove Widget"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sandbox Body */}
      <div className="flex-1 relative overflow-hidden bg-gray-950/20">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/40 backdrop-blur-sm z-10">
            <div className="h-8 w-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-widest">Initializing Sandbox</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={widget.metadata.name}
        />
      </div>

      {/* Footer Info */}
      {!isExpanded && (
        <div className="px-4 py-2 bg-gray-900/40 border-t border-gray-800/50 flex items-center justify-between text-[10px] text-gray-500">
          <div className="flex items-center gap-2">
            <Shield className="h-3 w-3 text-emerald-500/50" />
            <span>SANDBOXED EXECUTION</span>
          </div>
          <div className="flex items-center gap-3">
            {activeSubscriptions.size > 0 && (
              <span className="text-purple-400/70">{activeSubscriptions.size} EVENTS ACTIVE</span>
            )}
            <ExternalLink className="h-3 w-3 hover:text-gray-400 cursor-pointer transition-colors" />
          </div>
        </div>
      )}
    </div>
  );
};

export default WidgetSandbox;
