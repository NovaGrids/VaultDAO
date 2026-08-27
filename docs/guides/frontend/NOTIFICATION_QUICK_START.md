# Notification Center - Quick Start Guide

## Installation Complete ✓

The notification center has been integrated into your VaultDAO application. The bell icon in the header shows unread notification count.

## Quick Usage

### 1. Import the Hook

```typescript
import { useNotificationCenter } from '../hooks/useNotificationCenter';
```

### 2. Use in Your Component

```typescript
function MyComponent() {
  const { notify, notifyProposal, notifyApproval } = useNotificationCenter();

  // Simple notification
  notify('Title', 'Message');

  // Proposal notification with action
  notifyProposal('New Proposal', 'Review needed', [
    {
      id: 'view',
      label: 'View',
      type: 'view',
      variant: 'primary',
      handler: async () => {
        // Your action here
      },
    },
  ]);
}
```

## Common Patterns

### Proposal Submitted
```typescript
notifyProposal('Proposal Submitted', `"${title}" is now under review`, [
  {
    id: 'view',
    label: 'View Proposal',
    type: 'view',
    variant: 'primary',
    handler: async () => navigate(`/proposals/${id}`),
  },
]);
```

### Approval Required
```typescript
notifyApproval('Signature Required', 'Transaction needs your approval', [
  {
    id: 'approve',
    label: 'Sign Now',
    type: 'approve',
    variant: 'primary',
    handler: async () => await signTransaction(),
  },
]);
```

### System Alert
```typescript
notifySystem('Maintenance Scheduled', 'System will be down at 2 AM UTC', 'normal');
```

### Critical Error
```typescript
notifyCritical('Security Alert', 'Unusual activity detected', 'system');
```

## Priority Levels

- `critical` - Red, urgent issues (security, errors)
- `high` - Orange, important (approvals, proposals)
- `normal` - Blue, standard notifications
- `low` - Gray, informational

## Categories

- `proposals` - Proposal-related notifications
- `approvals` - Approval and signature requests
- `system` - System messages and alerts

## Features Available

✓ Read/unread tracking
✓ Filtering by category, priority, status
✓ Sorting by time or priority
✓ Pagination (20 per page)
✓ Swipe to dismiss (mobile)
✓ Keyboard navigation
✓ LocalStorage persistence
✓ Inline actions

## Testing

Use the demo component to test:

```typescript
import NotificationDemo from './components/NotificationDemo';

// Add to any page
<NotificationDemo />
```

## Files Created

- `frontend/src/types/notification.ts` - Type definitions
- `frontend/src/context/NotificationContext.tsx` - State management
- `frontend/src/hooks/useNotificationCenter.ts` - Easy-to-use hook
- `frontend/src/components/NotificationCenter.tsx` - Main panel
- `frontend/src/components/NotificationItem.tsx` - Individual items
- `frontend/src/components/NotificationActions.tsx` - Action buttons
- `frontend/src/components/NotificationDemo.tsx` - Demo component
- `frontend/src/examples/NotificationIntegration.tsx` - Integration examples

## Documentation

See `frontend/src/components/NOTIFICATION_CENTER.md` for complete documentation.

## Next Steps

1. Test the notification center by clicking the bell icon
2. Try the demo component: `<NotificationDemo />`
3. Integrate into your components using the examples
4. Customize categories/priorities as needed

## Support

- All components are TypeScript-ready
- Full accessibility support (ARIA, keyboard nav)
- Mobile-optimized with touch gestures
- Production-ready with error handling
