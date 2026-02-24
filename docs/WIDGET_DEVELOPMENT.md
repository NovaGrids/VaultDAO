# Widget Development Guide

Complete guide for developing custom widgets for VaultDAO dashboard system.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Widget SDK](#widget-sdk)
4. [Widget Structure](#widget-structure)
5. [Security & Sandboxing](#security--sandboxing)
6. [Publishing to Marketplace](#publishing-to-marketplace)
7. [Best Practices](#best-practices)
8. [Examples](#examples)

## Overview

The VaultDAO Widget System allows developers to create custom dashboard widgets that extend the platform's functionality. Widgets run in a secure sandboxed environment and communicate with the host application through a well-defined API.

### Key Features

- **Sandboxed Execution**: Widgets run in isolated iframes for security
- **Permission System**: Granular control over widget capabilities
- **Widget SDK**: Easy-to-use API for widget development
- **Marketplace**: Discover and install community widgets
- **Mobile Responsive**: Widgets adapt to different screen sizes

## Getting Started

### Prerequisites

- Basic knowledge of HTML, CSS, and JavaScript
- Understanding of web APIs and async programming
- Familiarity with the VaultDAO platform

### Quick Start

1. **Create Widget Manifest**

```json
{
  "metadata": {
    "id": "my-awesome-widget",
    "name": "My Awesome Widget",
    "version": "1.0.0",
    "author": "Your Name",
    "description": "A widget that does awesome things",
    "category": "analytics",
    "source": "third-party",
    "icon": "🚀",
    "tags": ["analytics", "charts", "data"],
    "createdAt": "2024-02-24",
    "updatedAt": "2024-02-24"
  },
  "permissions": {
    "network": true,
    "storage": false,
    "wallet": false,
    "notifications": false
  },
  "entryPoint": "https://your-domain.com/widget/index.html"
}
```

2. **Create Widget HTML**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Awesome Widget</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 1rem;
      margin: 0;
      background: transparent;
      color: #fff;
    }
  </style>
</head>
<body>
  <div id="widget-root"></div>
  <script src="widget.js"></script>
</body>
</html>
```

3. **Initialize Widget SDK**

```javascript
// widget.js
const widgetSDK = {
  widgetId: 'my-awesome-widget',
  permissions: { network: true },
  
  postMessage(type, payload) {
    window.parent.postMessage({
      widgetId: this.widgetId,
      type: type,
      payload: payload
    }, '*');
  },
  
  async getConfig() {
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
  
  async getData(query) {
    if (!this.permissions.network) {
      throw new Error('Network permission denied');
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
  }
};

// Initialize widget
async function init() {
  try {
    widgetSDK.postMessage('init', { ready: true });
    
    const config = await widgetSDK.getConfig();
    const data = await widgetSDK.getData('vault-stats');
    
    render(data);
  } catch (error) {
    widgetSDK.postMessage('error', { message: error.message });
  }
}

function render(data) {
  const root = document.getElementById('widget-root');
  root.innerHTML = `
    <div class="widget-container">
      <h3>My Awesome Widget</h3>
      <p>Data: ${JSON.stringify(data)}</p>
    </div>
  `;
}

init();
```

## Widget SDK

### Available Methods

#### `getConfig(): Promise<Record<string, any>>`

Retrieves widget configuration set by the user.

```javascript
const config = await widgetSDK.getConfig();
console.log(config.theme); // 'dark'
```

#### `setConfig(config: Record<string, any>): Promise<void>`

Updates widget configuration.

```javascript
await widgetSDK.setConfig({ theme: 'light', refreshInterval: 30 });
```

#### `getData(query: string): Promise<any>`

Fetches data from the host application. Requires `network` permission.

```javascript
const vaultData = await widgetSDK.getData('vault-balance');
const proposals = await widgetSDK.getData('proposals?status=active');
```

#### `sendNotification(message: string): Promise<void>`

Displays a notification to the user. Requires `notifications` permission.

```javascript
await widgetSDK.sendNotification('New proposal created!');
```

#### `requestPermission(permission: string): Promise<boolean>`

Requests additional permission from the user.

```javascript
const granted = await widgetSDK.requestPermission('notifications');
if (granted) {
  await widgetSDK.sendNotification('Permission granted!');
}
```

#### `on(event: string, handler: Function): void`

Listens for events from the host application.

```javascript
widgetSDK.on('data-update', (data) => {
  console.log('New data received:', data);
  render(data);
});
```

#### `emit(event: string, data: any): void`

Emits custom events to the host application.

```javascript
widgetSDK.emit('widget-action', { action: 'refresh' });
```

## Widget Structure

### Recommended File Structure

```
my-widget/
├── manifest.json          # Widget metadata and permissions
├── index.html            # Entry point
├── widget.js             # Main widget logic
├── styles.css            # Widget styles
├── assets/
│   ├── icon.png         # Widget icon
│   └── screenshot.png   # Marketplace screenshot
└── README.md            # Widget documentation
```

### Manifest Schema

```typescript
interface WidgetManifest {
  metadata: {
    id: string;              // Unique identifier
    name: string;            // Display name
    version: string;         // Semantic version
    author: string;          // Author name
    description: string;     // Short description
    category: 'analytics' | 'finance' | 'governance' | 'social' | 'utility' | 'other';
    source: 'built-in' | 'third-party' | 'custom';
    icon?: string;           // Icon emoji or URL
    thumbnail?: string;      // Preview image URL
    tags: string[];          // Search tags
    createdAt: string;       // ISO date
    updatedAt: string;       // ISO date
  };
  permissions: {
    network?: boolean;       // API access
    storage?: boolean;       // Local storage
    wallet?: boolean;        // Wallet interaction
    notifications?: boolean; // Show notifications
  };
  entryPoint: string;        // Widget URL
  configSchema?: object;     // Configuration schema
}
```

## Security & Sandboxing

### Sandbox Environment

Widgets run in iframes with the following sandbox attributes:

- `allow-scripts`: JavaScript execution
- No `allow-same-origin`: Prevents access to parent origin
- No `allow-forms`: Prevents form submission
- No `allow-popups`: Prevents popup windows

### Permission System

Widgets must declare required permissions in their manifest:

- **network**: Access to external APIs and data fetching
- **storage**: Local storage access for widget state
- **wallet**: Interaction with user's wallet
- **notifications**: Display notifications to users

### Security Best Practices

1. **Validate All Input**: Never trust data from external sources
2. **Sanitize HTML**: Prevent XSS attacks
3. **Use HTTPS**: Always serve widgets over HTTPS
4. **Minimize Permissions**: Only request necessary permissions
5. **Handle Errors**: Gracefully handle all error cases
6. **Rate Limiting**: Implement rate limiting for API calls

### Content Security Policy

Widgets should implement a strict CSP:

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https:;">
```

## Publishing to Marketplace

### Submission Process

1. **Prepare Widget**
   - Complete manifest.json
   - Test thoroughly
   - Create screenshots
   - Write documentation

2. **Host Widget**
   - Deploy to HTTPS endpoint
   - Ensure high availability
   - Set up CDN for performance

3. **Submit to Marketplace**
   - Create marketplace listing
   - Provide manifest URL
   - Upload screenshots
   - Set pricing (if applicable)

4. **Verification Process**
   - Security review
   - Functionality testing
   - Code quality check
   - Approval/rejection

### Marketplace Guidelines

- **Quality**: Widget must be functional and bug-free
- **Security**: No malicious code or security vulnerabilities
- **Performance**: Fast loading and responsive
- **Documentation**: Clear usage instructions
- **Support**: Provide support channel for users

## Best Practices

### Performance

1. **Lazy Loading**: Load resources on demand
2. **Debouncing**: Debounce frequent operations
3. **Caching**: Cache API responses when appropriate
4. **Minimize Bundle**: Keep widget size small

```javascript
// Debounce example
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

const debouncedUpdate = debounce(updateWidget, 300);
```

### Responsive Design

```css
/* Mobile-first approach */
.widget-container {
  padding: 1rem;
}

@media (min-width: 768px) {
  .widget-container {
    padding: 1.5rem;
  }
}

@media (min-width: 1024px) {
  .widget-container {
    padding: 2rem;
  }
}
```

### Error Handling

```javascript
async function fetchData() {
  try {
    const data = await widgetSDK.getData('vault-stats');
    return data;
  } catch (error) {
    console.error('Failed to fetch data:', error);
    widgetSDK.postMessage('error', {
      message: 'Failed to load widget data'
    });
    return null;
  }
}
```

### Accessibility

```html
<!-- Use semantic HTML -->
<button aria-label="Refresh widget" onclick="refresh()">
  <span aria-hidden="true">🔄</span>
  Refresh
</button>

<!-- Provide alt text for images -->
<img src="chart.png" alt="Treasury balance chart showing growth over time">

<!-- Use proper heading hierarchy -->
<h3>Widget Title</h3>
<h4>Section Title</h4>
```

## Examples

### Example 1: Simple Stats Widget

```javascript
const widgetSDK = {
  widgetId: 'simple-stats',
  permissions: { network: true },
  
  postMessage(type, payload) {
    window.parent.postMessage({
      widgetId: this.widgetId,
      type, payload
    }, '*');
  },
  
  async getData(query) {
    return new Promise((resolve) => {
      window.addEventListener('message', function handler(e) {
        if (e.data.type === 'data-response') {
          window.removeEventListener('message', handler);
          resolve(e.data.payload);
        }
      });
      this.postMessage('data', { query });
    });
  }
};

async function init() {
  widgetSDK.postMessage('init', { ready: true });
  
  const stats = await widgetSDK.getData('vault-stats');
  
  document.getElementById('widget-root').innerHTML = `
    <div style="padding: 1rem; background: rgba(139,92,246,0.1); border-radius: 0.5rem;">
      <h3 style="margin: 0 0 0.5rem 0; color: #fff;">Vault Stats</h3>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
        <div>
          <p style="margin: 0; color: #9ca3af; font-size: 0.875rem;">Balance</p>
          <p style="margin: 0; color: #fff; font-size: 1.25rem; font-weight: 600;">
            ${stats?.balance || '0'} XLM
          </p>
        </div>
        <div>
          <p style="margin: 0; color: #9ca3af; font-size: 0.875rem;">Proposals</p>
          <p style="margin: 0; color: #fff; font-size: 1.25rem; font-weight: 600;">
            ${stats?.proposals || '0'}
          </p>
        </div>
      </div>
    </div>
  `;
}

init();
```

### Example 2: Interactive Chart Widget

```javascript
// Requires Chart.js or similar library
async function createChartWidget() {
  widgetSDK.postMessage('init', { ready: true });
  
  const data = await widgetSDK.getData('treasury-history');
  
  const canvas = document.createElement('canvas');
  document.getElementById('widget-root').appendChild(canvas);
  
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: [{
        label: 'Treasury Balance',
        data: data.balances,
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      }
    }
  });
}
```

### Example 3: Notification Widget

```javascript
async function createNotificationWidget() {
  widgetSDK.postMessage('init', { ready: true });
  
  // Request notification permission
  const granted = await widgetSDK.requestPermission('notifications');
  
  if (granted) {
    // Listen for new proposals
    widgetSDK.on('proposal-created', async (proposal) => {
      await widgetSDK.sendNotification(
        `New proposal: ${proposal.title}`
      );
    });
  }
  
  document.getElementById('widget-root').innerHTML = `
    <div style="padding: 1rem;">
      <h3>Notifications ${granted ? '✅' : '❌'}</h3>
      <p>Notification permission: ${granted ? 'Granted' : 'Denied'}</p>
    </div>
  `;
}
```

## Support & Resources

- **Documentation**: https://docs.vaultdao.io/widgets
- **SDK Reference**: https://github.com/vaultdao/widget-sdk
- **Examples**: https://github.com/vaultdao/widget-examples
- **Community**: https://discord.gg/vaultdao

## License

Widget SDK is MIT licensed. Widgets can use any license compatible with the VaultDAO platform.
