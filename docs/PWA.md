# Progressive Web App (PWA) Documentation

## Overview

VaultDAO is now a fully-featured Progressive Web App (PWA), providing native app-like experiences with offline support, push notifications, and installability across devices.

## Features

### 1. App Installation 📱

Users can install VaultDAO as a standalone app on their devices:

- **Desktop**: Install via browser prompt or settings
- **Mobile**: Add to home screen for app-like experience
- **Automatic prompts**: Smart install prompts appear for eligible users
- **Manual installation**: Available in Settings > PWA

**Benefits:**
- Faster loading times
- Offline access
- Native app feel
- No app store required

### 2. Offline Support 🔌

The app works even without internet connection:

- **Cached assets**: Essential files cached for offline use
- **Network-first strategy**: Always tries network first, falls back to cache
- **Background sync**: Queues actions when offline, syncs when back online
- **Offline indicator**: Visual feedback when connection is lost

**What works offline:**
- View cached proposals
- Browse activity history
- Access settings
- View analytics (cached data)

**What requires connection:**
- Creating new proposals
- Wallet transactions
- Real-time updates
- Blockchain interactions

### 3. Push Notifications 🔔

Stay updated with important events:

- **Proposal updates**: New proposals, approvals, rejections
- **Activity alerts**: Transaction confirmations, errors
- **Custom notifications**: Configurable in settings
- **Action buttons**: Quick actions from notifications

**Setup:**
1. Go to Settings > PWA
2. Click "Enable" under Push Notifications
3. Allow notifications in browser prompt
4. Configure notification preferences

### 4. Fast Loading ⚡

Optimized performance for quick access:

- **Service worker caching**: Instant loading of cached content
- **Runtime caching**: Dynamic content cached as you browse
- **Preloading**: Critical resources loaded in advance
- **Background updates**: Cache updates without interrupting use

### 5. App Updates 🔄

Seamless updates without app store:

- **Automatic detection**: New versions detected automatically
- **Update prompts**: Friendly notification when update available
- **One-click update**: Apply updates instantly
- **No downtime**: Updates apply on next reload

## User Guide

### Installing the App

#### Desktop (Chrome/Edge)
1. Visit VaultDAO in your browser
2. Look for install icon in address bar
3. Click "Install" or wait for automatic prompt
4. App opens in standalone window

#### Mobile (iOS Safari)
1. Open VaultDAO in Safari
2. Tap Share button
3. Select "Add to Home Screen"
4. Tap "Add"

#### Mobile (Android Chrome)
1. Open VaultDAO in Chrome
2. Tap menu (three dots)
3. Select "Install app" or "Add to Home screen"
4. Tap "Install"

### Managing PWA Features

Access PWA settings: **Settings > Progressive Web App**

#### Connection Status
- Shows current online/offline state
- Automatic reconnection detection
- Visual indicators throughout app

#### App Installation
- Check installation status
- Install app if not already installed
- View installation instructions

#### Push Notifications
- Enable/disable notifications
- Check permission status
- Request notification access

#### Storage & Cache
- View cache size
- Clear cached data
- Manage offline storage

### Using Offline Mode

When offline:
1. **Offline indicator** appears at top of screen
2. **Limited features** - some actions disabled
3. **Cached content** - view previously loaded data
4. **Queue actions** - proposals queued for sync
5. **Auto-sync** - actions sync when back online

### Receiving Notifications

Notification types:
- **Proposal Created**: New proposal submitted
- **Proposal Approved**: Proposal received approval
- **Proposal Rejected**: Proposal was rejected
- **Proposal Executed**: Proposal executed successfully
- **Activity Update**: New activity in your vault

Notification actions:
- **View**: Open app to relevant page
- **Dismiss**: Close notification

## Technical Details

### Service Worker

Location: `frontend/public/sw.js`

**Caching Strategy:**
- **Precache**: Essential assets cached on install
- **Network First**: Try network, fallback to cache
- **Runtime Cache**: Dynamic content cached as accessed
- **Cache Versioning**: Old caches cleaned on update

**Features:**
- Background sync for offline actions
- Push notification handling
- Update management
- IndexedDB for offline data

### Manifest

Location: `frontend/public/manifest.json`

**Configuration:**
- App name and description
- Icons (72px to 512px)
- Theme colors
- Display mode (standalone)
- Shortcuts to key pages
- Share target for file sharing

### PWA Utilities

Location: `frontend/src/utils/pwa.ts`

**Functions:**
- `registerServiceWorker()` - Register SW
- `isInstalled()` - Check if installed
- `showInstallPrompt()` - Trigger install
- `requestNotificationPermission()` - Request notifications
- `subscribeToPushNotifications()` - Subscribe to push
- `isOnline()` - Check connection status
- `clearCache()` - Clear app cache
- `applyUpdate()` - Apply app update

### Components

**InstallPrompt** (`frontend/src/components/InstallPrompt.tsx`)
- Smart install banner
- Dismissible prompt
- Remembers user preference

**OfflineIndicator** (`frontend/src/components/OfflineIndicator.tsx`)
- Connection status indicator
- Reconnection notification
- Auto-hide when online

**UpdatePrompt** (`frontend/src/components/UpdatePrompt.tsx`)
- Update available notification
- One-click update
- Loading state

**PWASettings** (`frontend/src/components/PWASettings.tsx`)
- Comprehensive PWA management
- Installation controls
- Notification settings
- Cache management

## Browser Support

### Fully Supported
- ✅ Chrome 90+ (Desktop & Mobile)
- ✅ Edge 90+
- ✅ Firefox 90+
- ✅ Safari 15+ (iOS & macOS)
- ✅ Samsung Internet 14+

### Partial Support
- ⚠️ Safari 14 (Limited PWA features)
- ⚠️ Firefox iOS (Uses Safari engine)

### Not Supported
- ❌ Internet Explorer
- ❌ Opera Mini

## Best Practices

### For Users

1. **Install the app** for best experience
2. **Enable notifications** to stay updated
3. **Clear cache** if experiencing issues
4. **Update promptly** when notified
5. **Check connection** if features unavailable

### For Developers

1. **Test offline** functionality regularly
2. **Monitor cache size** to avoid bloat
3. **Version service worker** on changes
4. **Handle errors** gracefully offline
5. **Test on real devices** for accuracy

## Troubleshooting

### App Won't Install
- Check browser compatibility
- Ensure HTTPS connection
- Clear browser cache
- Try different browser

### Notifications Not Working
- Check browser permissions
- Verify notification settings
- Ensure app is installed
- Check system settings

### Offline Mode Issues
- Clear app cache
- Reload the app
- Check service worker status
- Verify browser support

### Update Not Applying
- Close all app tabs
- Clear browser cache
- Manually reload (Ctrl+Shift+R)
- Unregister service worker

## Security

### HTTPS Required
PWA features require secure connection (HTTPS)

### Permissions
- **Notifications**: Optional, user-controlled
- **Storage**: Automatic, limited by browser
- **Background Sync**: Automatic when enabled

### Privacy
- No tracking in service worker
- Cache cleared on user request
- Notifications opt-in only
- Data stored locally only

## Performance

### Metrics
- **First Load**: ~2s (network)
- **Cached Load**: <500ms
- **Offline Load**: <200ms
- **Cache Size**: ~5-10MB typical

### Optimization
- Lazy loading of routes
- Code splitting
- Image optimization
- Minimal service worker

## Future Enhancements

Planned features:
- [ ] Periodic background sync
- [ ] Advanced offline editing
- [ ] File system access
- [ ] Bluetooth device support
- [ ] Biometric authentication
- [ ] Share target improvements

## Resources

- [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Web.dev PWA](https://web.dev/progressive-web-apps/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)

## Support

For PWA-related issues:
1. Check browser console for errors
2. Verify service worker status
3. Review this documentation
4. Open GitHub issue with "PWA" label

---

Last updated: February 2026
