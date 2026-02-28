# Widget System Quick Start Guide

Get started with the VaultDAO Widget System in 5 minutes.

## For Users

### Installing Widgets

1. **Open Dashboard**
   ```
   Navigate to /dashboard
   Click "Advanced Dashboard" button
   ```

2. **Access Marketplace**
   ```
   Click "Widget Marketplace" button
   Browse available widgets
   ```

3. **Install a Widget**
   ```
   Click on any widget card
   Review permissions and details
   Click "Install Widget"
   ```

4. **Configure Widget**
   ```
   Click the settings icon on installed widget
   Modify configuration JSON
   Click "Save"
   ```

5. **Enable/Disable Widget**
   ```
   Click "Enabled" button to disable
   Click "Disabled" button to re-enable
   ```

### Managing Widgets

```typescript
// Widgets are stored in localStorage
localStorage.getItem('vaultdao-installed-widgets')

// Dashboard layout
localStorage.getItem('vaultdao-dashboard-layout')
```

## For Developers

### Creating Your First Widget

#### 1. Create Manifest

```json
{
  "metadata": {
    "id": "hello-world-widget",
    "name": "Hello World",
    "version": "1.0.0",
    "author": "Your Name",
    "description": "A simple hello world widget",
    "category": "utility",
    "source": "third-party",
    "icon": "👋",
    "tags": ["demo", "tutorial"],
    "createdAt": "2024-02-24",
    "updatedAt": "2024-02-24"
  },
  "permissions": {
    "network": false,
    "storage": false,
    "wallet": false,
    "notifications": false
  },
  "entryPoint": "https://your-domain.com/widgets/hello-world/index.html"
}
```

#### 2. Create Widget HTML

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hello World Widget</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      padding: 1rem;
      margin: 0;
      background: transparent;
      color: #fff;
    }
    .container {
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 0.5rem;
      padding: 1.5rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="widget-root"></div>
  <script src="widget.js"></script>
</body>
</html>
```

#### 3. Create Widget Logic

```javascript
// widget.js
const widgetSDK = {
  widgetId: 'hello-world-widget',
  permissions: {},
  
  postMessage(type, payload) {
    window.parent.postMessage({
      widgetId: this.widgetId,
      type: type,
      payload: payload
    }, '*');
  }
};

function init() {
  widgetSDK.postMessage('init', { ready: true });
  
  const root = document.getElementById('widget-root');
  root.innerHTML = `
    <div class="container">
      <h2>👋 Hello World!</h2>
      <p>Your first VaultDAO widget is running!</p>
      <p style="font-size: 0.875rem; color: #9ca3af; margin-top: 1rem;">
        Widget ID: ${widgetSDK.widgetId}
      </p>
    </div>
  `;
}

init();
```

#### 4. Host Your Widget

```bash
# Deploy to any static hosting
# Examples:
# - Vercel: vercel deploy
# - Netlify: netlify deploy
# - GitHub Pages: git push
# - AWS S3: aws s3 sync ./dist s3://your-bucket
```

#### 5. Test Locally

```javascript
// Add to marketplace mock data in WidgetMarketplace.tsx
{
  manifest: {
    metadata: {
      id: 'hello-world-widget',
      name: 'Hello World',
      // ... rest of manifest
    },
    permissions: {},
    entryPoint: 'http://localhost:3000/widget.html'
  },
  downloads: 0,
  rating: 5.0,
  reviews: 0,
  verified: false
}
```

### Using the Widget SDK

#### Get Configuration

```javascript
const config = await widgetSDK.getConfig();
console.log(config.theme); // 'dark'
```

#### Fetch Data (requires network permission)

```javascript
const data = await widgetSDK.getData('vault-stats');
console.log(data.balance);
```

#### Send Notification (requires notifications permission)

```javascript
await widgetSDK.sendNotification('Widget updated!');
```

#### Listen for Events

```javascript
widgetSDK.on('data-update', (data) => {
  console.log('New data:', data);
  updateUI(data);
});
```

### Widget Development Tips

#### 1. Mobile Responsive

```css
/* Mobile-first approach */
.widget {
  padding: 1rem;
}

@media (min-width: 768px) {
  .widget {
    padding: 1.5rem;
  }
}
```

#### 2. Error Handling

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

#### 3. Loading States

```javascript
function showLoading() {
  root.innerHTML = '<div class="loading">Loading...</div>';
}

function hideLoading() {
  // Render actual content
}
```

#### 4. Auto-refresh

```javascript
async function init() {
  await fetchAndRender();
  
  // Refresh every 30 seconds
  setInterval(fetchAndRender, 30000);
}
```

## Common Use Cases

### 1. Stats Widget

```javascript
async function createStatsWidget() {
  const stats = await widgetSDK.getData('vault-stats');
  
  root.innerHTML = `
    <div class="stats-grid">
      <div class="stat">
        <div class="label">Balance</div>
        <div class="value">${stats.balance}</div>
      </div>
      <div class="stat">
        <div class="label">Proposals</div>
        <div class="value">${stats.proposals}</div>
      </div>
    </div>
  `;
}
```

### 2. Chart Widget

```javascript
async function createChartWidget() {
  const data = await widgetSDK.getData('treasury-history');
  
  // Use Chart.js or similar
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: [{
        label: 'Balance',
        data: data.balances
      }]
    }
  });
}
```

### 3. List Widget

```javascript
async function createListWidget() {
  const items = await widgetSDK.getData('recent-proposals');
  
  root.innerHTML = `
    <ul class="list">
      ${items.map(item => `
        <li class="list-item">
          <div class="title">${item.title}</div>
          <div class="meta">${item.status}</div>
        </li>
      `).join('')}
    </ul>
  `;
}
```

## Testing Your Widget

### Local Testing

```bash
# Start local server
python -m http.server 8000

# Or use Node.js
npx http-server -p 8000

# Access at http://localhost:8000/widget.html
```

### Integration Testing

```javascript
// Test in VaultDAO dashboard
// 1. Add to marketplace mock data
// 2. Install from marketplace
// 3. Verify functionality
// 4. Test on mobile
```

## Troubleshooting

### Widget Not Loading

```javascript
// Check console for errors
console.log('Widget initializing...');

// Verify postMessage
widgetSDK.postMessage('init', { ready: true });

// Check permissions
console.log('Permissions:', widgetSDK.permissions);
```

### Permission Denied

```javascript
// Request permission
const granted = await widgetSDK.requestPermission('network');
if (!granted) {
  console.error('Permission denied');
}
```

### Data Not Updating

```javascript
// Verify data query
const data = await widgetSDK.getData('vault-stats');
console.log('Data received:', data);

// Check refresh interval
setInterval(async () => {
  const newData = await widgetSDK.getData('vault-stats');
  render(newData);
}, 30000);
```

## Resources

- **Full Documentation**: `/docs/WIDGET_DEVELOPMENT.md`
- **SDK Reference**: `/frontend/src/sdk/WidgetSDK.ts`
- **Example Widget**: `/frontend/src/examples/SampleThirdPartyWidget.tsx`
- **Type Definitions**: `/frontend/src/types/widget.ts`

## Next Steps

1. Read the full documentation
2. Study the example widgets
3. Create your first widget
4. Test thoroughly
5. Submit to marketplace
6. Share with community

## Support

- GitHub Issues: Report bugs and request features
- Discord: Join the VaultDAO community
- Documentation: Comprehensive guides and references

Happy widget building! 🚀
