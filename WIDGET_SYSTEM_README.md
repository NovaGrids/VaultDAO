# VaultDAO Widget System

Complete custom dashboard widget system with third-party support, marketplace, and SDK.

## 📋 Table of Contents

- [Overview](#overview)
- [Quick Links](#quick-links)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Documentation](#documentation)
- [File Structure](#file-structure)
- [Usage Examples](#usage-examples)
- [Security](#security)
- [Contributing](#contributing)

## 🎯 Overview

The VaultDAO Widget System enables users to customize their dashboards with built-in and third-party widgets. Developers can create custom widgets using our SDK, publish them to the marketplace, and users can install them with one click.

### Key Highlights

✅ **Secure Sandboxing** - Widgets run in isolated iframes  
✅ **Permission System** - Granular control over widget capabilities  
✅ **Widget Marketplace** - Discover and install community widgets  
✅ **Developer SDK** - Easy-to-use API for widget development  
✅ **Mobile Responsive** - Works seamlessly on all devices  
✅ **Built-in Widgets** - Charts, stats, lists, and more  

## 🔗 Quick Links

### For Users
- [Quick Start Guide](WIDGET_SYSTEM_QUICKSTART.md) - Get started in 5 minutes
- [Implementation Summary](WIDGET_SYSTEM_IMPLEMENTATION.md) - Technical details

### For Developers
- [Widget Development Guide](docs/WIDGET_DEVELOPMENT.md) - Complete development guide
- [SDK Documentation](frontend/src/sdk/README.md) - API reference
- [Example Widget](frontend/src/examples/SampleThirdPartyWidget.tsx) - Sample code
- [SDK Tests](frontend/src/sdk/__tests__/WidgetSDK.test.ts) - Test examples

## ✨ Features

### Widget System
- Widget registry and lifecycle management
- Install, configure, enable/disable, uninstall
- Usage tracking and statistics
- Local storage persistence

### Widget Marketplace
- Browse available widgets
- Search and filter by category
- Sort by popularity, rating, or recency
- Verified widget badges
- One-click installation
- Widget details and screenshots

### Widget SDK
- Simple API for widget development
- Configuration management
- Data fetching
- Notification system
- Event handling
- Permission management

### Security
- Iframe sandboxing
- Permission system (network, storage, wallet, notifications)
- Content Security Policy
- Input validation
- Error boundaries

### Mobile Support
- Responsive grid layouts
- Touch-friendly controls
- Optimized for small screens
- Adaptive UI components

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         VaultDAO Dashboard              │
│  ┌───────────────────────────────────┐  │
│  │      Widget System                │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   Widget Marketplace        │  │  │
│  │  │   - Browse                  │  │  │
│  │  │   - Search & Filter         │  │  │
│  │  │   - Install                 │  │  │
│  │  └─────────────────────────────┘  │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   Widget Registry           │  │  │
│  │  │   - Installed Widgets       │  │  │
│  │  │   - Configuration           │  │  │
│  │  │   - Permissions             │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │      Widget Sandbox (iframe)      │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   Third-Party Widget        │  │  │
│  │  │   - HTML/CSS/JS             │  │  │
│  │  │   - Widget SDK              │  │  │
│  │  │   - Isolated Environment    │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         ↕ postMessage API
┌─────────────────────────────────────────┐
│      External Widget Server             │
│      https://widgets.example.com        │
└─────────────────────────────────────────┘
```

## 🚀 Getting Started

### For Users

1. **Access Widget System**
   ```
   Dashboard → Advanced Dashboard → Widget Marketplace
   ```

2. **Install a Widget**
   - Browse marketplace
   - Click on widget
   - Review permissions
   - Click "Install"

3. **Configure Widget**
   - Click settings icon
   - Modify configuration
   - Save changes

### For Developers

1. **Create Widget Manifest**
   ```json
   {
     "metadata": {
       "id": "my-widget",
       "name": "My Widget",
       "version": "1.0.0",
       "author": "Your Name",
       "description": "Widget description",
       "category": "analytics",
       "source": "third-party"
     },
     "permissions": {
       "network": true
     },
     "entryPoint": "https://your-domain.com/widget.html"
   }
   ```

2. **Create Widget HTML**
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <title>My Widget</title>
   </head>
   <body>
     <div id="widget-root"></div>
     <script src="widget.js"></script>
   </body>
   </html>
   ```

3. **Initialize Widget SDK**
   ```javascript
   const widgetSDK = {
     widgetId: 'my-widget',
     permissions: { network: true },
     
     postMessage(type, payload) {
       window.parent.postMessage({
         widgetId: this.widgetId,
         type, payload
       }, '*');
     }
   };
   
   async function init() {
     widgetSDK.postMessage('init', { ready: true });
     const data = await widgetSDK.getData('vault-stats');
     render(data);
   }
   
   init();
   ```

4. **Deploy and Test**
   - Deploy to HTTPS endpoint
   - Add to marketplace
   - Test installation

## 📚 Documentation

### User Documentation
- [Quick Start Guide](WIDGET_SYSTEM_QUICKSTART.md) - 5-minute setup
- [Implementation Summary](WIDGET_SYSTEM_IMPLEMENTATION.md) - Technical overview

### Developer Documentation
- [Widget Development Guide](docs/WIDGET_DEVELOPMENT.md) - Complete guide
- [SDK Reference](frontend/src/sdk/README.md) - API documentation
- [Helper Functions](frontend/src/sdk/widgetHelpers.ts) - Utility functions
- [Type Definitions](frontend/src/types/widget.ts) - TypeScript types

### Examples
- [Sample Widget](frontend/src/examples/SampleThirdPartyWidget.tsx) - Full example
- [SDK Tests](frontend/src/sdk/__tests__/WidgetSDK.test.ts) - Test examples

## 📁 File Structure

```
VaultDAO/
├── docs/
│   └── WIDGET_DEVELOPMENT.md          # Complete development guide
├── frontend/src/
│   ├── components/
│   │   ├── WidgetSystem.tsx           # Main widget management
│   │   ├── WidgetMarketplace.tsx      # Widget marketplace
│   │   ├── WidgetSandbox.tsx          # Secure widget sandbox
│   │   ├── WidgetLibrary.tsx          # Built-in widget library
│   │   └── DashboardBuilder.tsx       # Dashboard integration
│   ├── sdk/
│   │   ├── WidgetSDK.ts               # Widget SDK implementation
│   │   ├── widgetHelpers.ts           # Helper functions
│   │   ├── README.md                  # SDK documentation
│   │   └── __tests__/
│   │       └── WidgetSDK.test.ts      # SDK tests
│   ├── types/
│   │   ├── widget.ts                  # Widget type definitions
│   │   └── dashboard.ts               # Dashboard types
│   └── examples/
│       └── SampleThirdPartyWidget.tsx # Example widget
├── WIDGET_SYSTEM_IMPLEMENTATION.md    # Implementation summary
├── WIDGET_SYSTEM_QUICKSTART.md        # Quick start guide
└── WIDGET_SYSTEM_README.md            # This file
```

## 💡 Usage Examples

### Installing a Widget

```typescript
import WidgetSystem from './components/WidgetSystem';

<WidgetSystem
  onWidgetAdd={(widget) => console.log('Added:', widget)}
  onWidgetRemove={(id) => console.log('Removed:', id)}
/>
```

### Creating a Custom Widget

```javascript
// Simple stats widget
const widgetSDK = {
  widgetId: 'stats-widget',
  permissions: { network: true },
  
  async init() {
    const stats = await this.getData('vault-stats');
    document.getElementById('root').innerHTML = `
      <div class="stats">
        <h3>Balance: ${stats.balance}</h3>
        <p>Proposals: ${stats.proposals}</p>
      </div>
    `;
  }
};

widgetSDK.init();
```

### Using Widget SDK

```javascript
// Get configuration
const config = await widgetSDK.getConfig();

// Fetch data
const data = await widgetSDK.getData('vault-stats');

// Send notification
await widgetSDK.sendNotification('Widget updated!');

// Listen for events
widgetSDK.on('data-update', (data) => {
  console.log('New data:', data);
});
```

## 🔒 Security

### Sandboxing
- Widgets run in iframes with `sandbox="allow-scripts"`
- No same-origin access
- No form submission
- No popup windows

### Permissions
- **network**: API access and data fetching
- **storage**: Local storage access
- **wallet**: Wallet interaction
- **notifications**: Display notifications

### Best Practices
- Validate all input
- Sanitize HTML
- Use HTTPS only
- Implement CSP
- Handle errors gracefully
- Rate limit API calls

## 🤝 Contributing

### For Widget Developers

1. Read the [Widget Development Guide](docs/WIDGET_DEVELOPMENT.md)
2. Create your widget following best practices
3. Test thoroughly
4. Submit to marketplace
5. Provide support for users

### For Platform Developers

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

### Guidelines

- Follow TypeScript best practices
- Write comprehensive tests
- Document all public APIs
- Ensure mobile responsiveness
- Follow security guidelines

## 📊 Widget Categories

- **Analytics**: Charts, graphs, data visualization
- **Finance**: Balance tracking, price feeds, transactions
- **Governance**: Proposals, voting, member management
- **Social**: Member directory, activity feeds, comments
- **Utility**: Tools, calculators, converters

## 🎨 Built-in Widgets

- Line Chart Widget
- Bar Chart Widget
- Pie Chart Widget
- Stat Card Widget
- Proposal List Widget
- Calendar Widget

## 🔧 Configuration

### Widget Configuration

```json
{
  "theme": "dark",
  "refreshInterval": 30,
  "showLabels": true,
  "customSettings": {
    "key": "value"
  }
}
```

### Storage

Widgets are stored in localStorage:
- `vaultdao-installed-widgets` - Installed widgets
- `vaultdao-dashboard-layout` - Dashboard layout

## 📱 Mobile Support

- Responsive grid layouts
- Touch-friendly controls (min 44px tap targets)
- Optimized for small screens
- Adaptive breakpoints:
  - Mobile: < 768px
  - Tablet: 768px - 1024px
  - Desktop: > 1024px

## 🐛 Troubleshooting

### Widget Not Loading
- Check browser console for errors
- Verify widget URL is HTTPS
- Check permissions in manifest
- Ensure postMessage is working

### Permission Denied
- Review required permissions
- Request permission from user
- Check permission in widget code

### Data Not Updating
- Verify network permission
- Check data query syntax
- Implement refresh interval
- Handle errors properly

## 📈 Performance

- Lazy load widgets
- Debounce frequent operations
- Cache API responses
- Minimize bundle size
- Clean up resources

## 🌐 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

Requires:
- ES6+ JavaScript
- CSS Grid and Flexbox
- postMessage API
- iframe sandbox attribute

## 📝 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- VaultDAO Team
- Widget SDK Contributors
- Community Widget Developers

## 📞 Support

- Documentation: `/docs/WIDGET_DEVELOPMENT.md`
- Examples: `/frontend/src/examples/`
- Issues: GitHub Issues
- Community: Discord

---

**Ready to build amazing widgets?** Start with the [Quick Start Guide](WIDGET_SYSTEM_QUICKSTART.md)!
