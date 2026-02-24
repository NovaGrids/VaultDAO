/**
 * Sample Third-Party Widget
 * Demonstrates how to create a custom widget using the Widget SDK
 */

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

/**
 * This is an example of what a third-party widget HTML would look like
 * In production, this would be hosted externally and loaded via iframe
 */

export const SampleWidgetHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Treasury Tracker Widget</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: transparent;
      color: #fff;
      padding: 1rem;
    }
    .widget-container {
      background: rgba(139, 92, 246, 0.05);
      border: 1px solid rgba(139, 92, 246, 0.2);
      border-radius: 0.75rem;
      padding: 1.5rem;
    }
    .widget-header {
      display: flex;
      align-items: center;
      justify-content: between;
      margin-bottom: 1rem;
    }
    .widget-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .widget-subtitle {
      font-size: 0.875rem;
      color: #9ca3af;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .stat-card {
      background: rgba(0, 0, 0, 0.2);
      padding: 1rem;
      border-radius: 0.5rem;
    }
    .stat-label {
      font-size: 0.75rem;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      margin-top: 0.5rem;
    }
    .stat-change {
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .loading {
      text-align: center;
      padding: 2rem;
      color: #9ca3af;
    }
    @media (max-width: 640px) {
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div id="widget-root">
    <div class="loading">Loading widget...</div>
  </div>
  
  <script>
    // Widget SDK
    const widgetSDK = {
      widgetId: 'treasury-tracker',
      permissions: { network: true, storage: true },
      
      postMessage(type, payload) {
        window.parent.postMessage({
          widgetId: this.widgetId,
          type: type,
          payload: payload
        }, '*');
      },
      
      async getConfig() {
        return new Promise((resolve) => {
          const handler = (e) => {
            if (e.data.type === 'config-response') {
              window.removeEventListener('message', handler);
              resolve(e.data.payload);
            }
          };
          window.addEventListener('message', handler);
          this.postMessage('config', null);
        });
      },
      
      async getData(query) {
        if (!this.permissions.network) {
          throw new Error('Network permission denied');
        }
        return new Promise((resolve) => {
          const handler = (e) => {
            if (e.data.type === 'data-response') {
              window.removeEventListener('message', handler);
              resolve(e.data.payload);
            }
          };
          window.addEventListener('message', handler);
          this.postMessage('data', { query });
        });
      }
    };
    
    // Widget Logic
    async function init() {
      try {
        widgetSDK.postMessage('init', { ready: true });
        
        const config = await widgetSDK.getConfig();
        const data = await widgetSDK.getData('vault-stats');
        
        render(data, config);
        
        // Auto-refresh every 30 seconds
        setInterval(async () => {
          const newData = await widgetSDK.getData('vault-stats');
          render(newData, config);
        }, 30000);
        
      } catch (error) {
        widgetSDK.postMessage('error', { message: error.message });
        renderError(error.message);
      }
    }
    
    function render(data, config) {
      const root = document.getElementById('widget-root');
      
      // Mock data for demonstration
      const stats = {
        balance: data?.totalBalance || '1,234,567',
        change24h: '+5.2%',
        proposals: data?.totalProposals || '12',
        activeSigners: data?.activeSigners || '8'
      };
      
      root.innerHTML = \`
        <div class="widget-container">
          <div class="widget-header">
            <div>
              <h3 class="widget-title">Treasury Tracker</h3>
              <p class="widget-subtitle">Real-time vault statistics</p>
            </div>
          </div>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Total Balance</div>
              <div class="stat-value">\${stats.balance}</div>
              <div class="stat-change positive">\${stats.change24h} (24h)</div>
            </div>
            
            <div class="stat-card">
              <div class="stat-label">Active Proposals</div>
              <div class="stat-value">\${stats.proposals}</div>
            </div>
            
            <div class="stat-card">
              <div class="stat-label">Active Signers</div>
              <div class="stat-value">\${stats.activeSigners}</div>
            </div>
          </div>
        </div>
      \`;
    }
    
    function renderError(message) {
      const root = document.getElementById('widget-root');
      root.innerHTML = \`
        <div class="widget-container" style="border-color: #ef4444;">
          <div style="color: #ef4444;">
            <strong>Error:</strong> \${message}
          </div>
        </div>
      \`;
    }
    
    // Initialize widget
    init();
  </script>
</body>
</html>
`;

/**
 * React component wrapper for demonstration
 * Shows how the widget would appear in the dashboard
 */
const SampleThirdPartyWidget: React.FC = () => {
  const [stats, setStats] = useState({
    balance: '1,234,567',
    change24h: '+5.2',
    proposals: 12,
    activeSigners: 8,
  });

  useEffect(() => {
    // Simulate data updates
    const interval = setInterval(() => {
      setStats(prev => ({
        ...prev,
        balance: (parseFloat(prev.balance.replace(/,/g, '')) + Math.random() * 1000).toLocaleString(),
        change24h: (Math.random() * 10 - 5).toFixed(1),
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const isPositive = parseFloat(stats.change24h) >= 0;

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-purple-800/10 border border-purple-500/30 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Treasury Tracker</h3>
          <p className="text-sm text-gray-400">Real-time vault statistics</p>
        </div>
        <Activity className="h-6 w-6 text-purple-400" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-black/20 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
            Total Balance
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            ${stats.balance}
          </div>
          <div className={`text-sm flex items-center gap-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            <span>{stats.change24h}% (24h)</span>
          </div>
        </div>

        <div className="bg-black/20 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
            Active Proposals
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.proposals}
          </div>
        </div>

        <div className="bg-black/20 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
            Active Signers
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.activeSigners}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-purple-500/20">
        <p className="text-xs text-gray-500 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Widget running in sandboxed environment
        </p>
      </div>
    </div>
  );
};

export default SampleThirdPartyWidget;
