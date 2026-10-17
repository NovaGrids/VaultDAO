import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Shield, X, Maximize2, Minimize2, ExternalLink } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useProposals } from '../hooks/useProposals';
import { useVaultContract } from '../hooks/useVaultContract';
import type { InstalledWidget, WidgetMessage, WidgetEventType } from '../types/widget';
import { buildWidgetSandboxHtml, isValidWidgetId } from '../utils/widgetSandbox';
import { getDataActionPermission, hasPermission, permissionDenied, resolveNavigationPath, resolvePermissionRequest } from '../utils/widgetPermissions';

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

        case 'data': {
          const required = getDataActionPermission(payload.action);
          if (!required) break;
          if (!hasPermission(widget.permissions, required)) {
            respond(permissionDenied(required));
            break;
          }
          if (payload.action === 'getProposals') {
            respond(proposals);
          } else {
            const config = await getVaultConfig();
            respond(config);
          }
          break;
        }

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
        if (hasPermission(widget.permissions, 'notifications')) {
          showToast(payload.message as string, (payload.type as any) || 'info');
          respond({ success: true });
        } else {
          respond(permissionDenied('notifications'));
        }
        break;

      case 'navigate': {
        if (!hasPermission(widget.permissions, 'navigation')) {
          respond(permissionDenied('navigation'));
          break;
        }
        const path = resolveNavigationPath(payload.path);
        if (!path) {
          respond({ error: 'invalid_path' });
          break;
        }
        navigate(path);
        respond({ success: true });
        break;
      }

      case 'subscribe':
        if (!hasPermission(widget.permissions, 'events')) {
          respond(permissionDenied('events'));
          break;
        }
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

      case 'request-permission': {
        const granted = resolvePermissionRequest(widget, payload.permission, (permission) =>
          window.confirm(`"${widget.metadata.name}" is requesting the "${permission}" permission. Allow it?`)
        );
        respond(granted);
        break;
      }
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
    if (!isValidWidgetId(widget.id)) {
      setError('This widget has an invalid id and cannot be loaded.');
      return;
    }

    const blob = new Blob([buildWidgetSandboxHtml(widget.id)], { type: 'text/html' });
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
