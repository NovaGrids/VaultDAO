# VaultDAO Widget SDK

The official SDK for developing custom widgets for the VaultDAO dashboard platform.

## Installation

For third-party widget developers, include the SDK in your widget HTML:

```html
<script src="https://cdn.vaultdao.io/widget-sdk/v1/sdk.js"></script>
```

Or use the inline version (recommended for sandboxed environments):

```javascript
// Copy the SDK code directly into your widget
const widgetSDK = { /* SDK implementation */ };
```

## Quick Start

```javascript
// Initialize SDK
const widgetSDK = {
  widgetId: 'my-widget',
  permissions: { network: true },
  
  postMessage(type, payload) {
    window.parent.postMessage({
      widgetId: this.widgetId,
      type: type,
      payload: payload
    }, '*');
  }
};

// Initialize widget
async function init() {
  widgetSDK.postMessage('init', { ready: true });
  
  const config = await widgetSDK.getConfig();
  const data = await widgetSDK.getData('vault-stats');
  
  render(data, config);
}

init();
```

## API Reference

### Core Methods

#### `postMessage(type: string, payload: any): void`

Send a message to the host application.

```javascript
widgetSDK.postMessage('init', { ready: true });
```

#### `getConfig(): Promise<Record<string, any>>`

Retrieve widget configuration.

```javascript
const config = await widgetSDK.getConfig();
console.log(config.theme); // 'dark'
```

#### `setConfig(config: Record<string, any>): Promise<void>`

Update widget configuration.

```javascript
await widgetSDK.setConfig({
  theme: 'light',
  refreshInterval: 30
});
```

#### `getData(query: string): Promise<any>`

Fetch data from the host application. Requires `network` permission.

```javascript
const data = await widgetSDK.getData('vault-balance');
```

#### `sendNotification(message: string): Promise<void>`

Display a notification. Requires `notifications` permission.

```javascript
await widgetSDK.sendNotification('Widget updated!');
```

#### `requestPermission(permission: string): Promise<boolean>`

Request additional permission from the user.

```javascript
const granted = await widgetSDK.requestPermission('notifications');
```

#### `on(event: string, handler: Function): void`

Listen for events from the host application.

```javascript
widgetSDK.on('data-update', (data) => {
  console.log('New data:', data);
});
```

#### `emit(event: string, data: any): void`

Emit custom events to the host application.

```javascript
widgetSDK.emit('widget-action', { action: 'refresh' });
```

## Permissions

Declare required permissions in your widget manifest:

```json
{
  "permissions": {
    "network": true,      // API access
    "storage": true,      // Local storage
    "wallet": false,      // Wallet interaction
    "notifications": false // Show notifications
  }
}
```

## Data Queries

Available data queries:

- `vault-stats` - Vault statistics
- `vault-balance` - Current balance
- `proposals` - List of proposals
- `proposals?status=active` - Filtered proposals
- `treasury-history` - Historical data
- `token-balances` - Token balances

## Events

Listen for these events:

- `data-update` - Data has been updated
- `config-change` - Configuration changed
- `theme-change` - Theme changed
- `proposal-created` - New proposal created
- `proposal-executed` - Proposal executed

## Utilities

### WidgetUtils

```javascript
import { WidgetUtils } from './WidgetSDK';

// Validate manifest
const isValid = WidgetUtils.validateManifest(manifest);

// Sanitize HTML
const safe = WidgetUtils.sanitizeHTML(userInput);

// Format date
const formatted = WidgetUtils.formatDate(new Date());

// Debounce function
const debounced = WidgetUtils.debounce(myFunction, 300);
```

## Best Practices

### 1. Error Handling

```javascript
try {
  const data = await widgetSDK.getData('vault-stats');
  render(data);
} catch (error) {
  widgetSDK.postMessage('error', {
    message: error.message
  });
}
```

### 2. Loading States

```javascript
function showLoading() {
  root.innerHTML = '<div class="loading">Loading...</div>';
}

async function fetchData() {
  showLoading();
  const data = await widgetSDK.getData('vault-stats');
  render(data);
}
```

### 3. Responsive Design

```css
.widget {
  padding: 1rem;
}

@media (min-width: 768px) {
  .widget {
    padding: 1.5rem;
  }
}
```

### 4. Performance

```javascript
// Debounce frequent operations
const debouncedUpdate = WidgetUtils.debounce(updateWidget, 300);

// Cache data when appropriate
let cachedData = null;
let cacheTime = 0;

async function getData() {
  const now = Date.now();
  if (cachedData && now - cacheTime < 30000) {
    return cachedData;
  }
  
  cachedData = await widgetSDK.getData('vault-stats');
  cacheTime = now;
  return cachedData;
}
```

## Examples

See `/frontend/src/examples/SampleThirdPartyWidget.tsx` for complete examples.

## TypeScript Support

```typescript
import type {
  WidgetAPI,
  WidgetMessage,
  WidgetPermissions,
  WidgetManifest
} from '../types/widget';

class MyWidget implements WidgetAPI {
  // Implementation
}
```

## Testing

```javascript
// Mock SDK for testing
const mockSDK = {
  getConfig: jest.fn().mockResolvedValue({ theme: 'dark' }),
  getData: jest.fn().mockResolvedValue({ balance: 1000 }),
  sendNotification: jest.fn().mockResolvedValue(undefined)
};
```

## Support

- Documentation: `/docs/WIDGET_DEVELOPMENT.md`
- Examples: `/frontend/src/examples/`
- Types: `/frontend/src/types/widget.ts`

## License

MIT License - See LICENSE file for details
