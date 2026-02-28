# Notification Center System

A comprehensive, production-ready notification center for VaultDAO that replaces basic toast notifications with a fully functional, mobile-responsive system.

## Features

### Core Functionality
- **Categorization**: Organize notifications by type (proposals, approvals, system)
- **Priority Levels**: Visual hierarchy with critical, high, normal, and low priorities
- **State Tracking**: Read/unread status with visual indicators
- **Persistence**: Notifications stored in localStorage (max 500)
- **History**: Full notification history with pagination
- **Actions**: Inline actions (approve, view, dismiss) with async support

### User Experience
- **Filtering**: Filter by category, priority, and read status
- **Sorting**: Sort by timestamp or priority (ascending/descending)
- **Pagination**: Handle large notification lists efficiently (20 per page)
- **Mobile Responsive**: Optimized for mobile with swipe-to-dismiss gestures
- **Accessibility**: Full ARIA support and keyboard navigation
- **Visual Feedback**: Priority-based color coding and unread indicators

## Components

### NotificationCenter
Main panel component that displays all notifications with filtering, sorting, and pagination.

**Props:**
- `isOpen: boolean` - Controls panel visibility
- `onClose: () => void` - Callback when panel is closed

### NotificationItem
Individual notification display with swipe gestures and inline actions.

**Props:**
- `notification: Notification` - Notification data
- `onMarkAsRead: (id: string) => void` - Mark as read callback
- `onDismiss: (id: string) => void` - Dismiss callback

### NotificationActions
Action buttons for notifications (approve, view, dismiss, custom).

**Props:**
- `notificationId: string` - ID of the notification
- `actions: NotificationAction[]` - Array of actions
- `onActionComplete?: (actionId: string) => void` - Callback after action completes

## Usage

### Basic Setup

The notification system is already integrated into the app via `NotificationProvider` in `main.tsx`.

### Using the Hook

```typescript
import { useNotificationCenter } from '../hooks/useNotificationCenter';

function MyComponent() {
  const { notify, notifyProposal, notifyApproval, notifySystem, notifyCritical } = useNotificationCenter();

  // Basic notification
  notify('Title', 'Message', {
    category: 'system',
    priority: 'normal',
  });

  // Proposal notification with actions
  notifyProposal('New Proposal', 'A proposal needs your review', [
    {
      id: 'view',
      label: 'View Proposal',
      type: 'view',
      variant: 'primary',
      handler: async (notificationId) => {
        // Handle action
        console.log('Viewing proposal:', notificationId);
      },
    },
  ]);

  // Approval notification
  notifyApproval('Approval Required', 'Sign transaction #12345', [
    {
      id: 'approve',
      label: 'Approve',
      type: 'approve',
      variant: 'primary',
      handler: async (notificationId) => {
        // Handle approval
      },
    },
  ]);

  // System notification
  notifySystem('System Update', 'New features available', 'normal');

  // Critical alert
  notifyCritical('Security Alert', 'Unusual activity detected', 'system');
}
```

### Direct Context Usage

```typescript
import { useNotifications } from '../context/NotificationContext';

function MyComponent() {
  const {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    setFilter,
    setSort,
    clearAll,
  } = useNotifications();

  // Add custom notification
  addNotification({
    title: 'Custom Notification',
    message: 'This is a custom notification',
    category: 'proposals',
    priority: 'high',
    actions: [
      {
        id: 'custom-action',
        label: 'Custom Action',
        type: 'custom',
        variant: 'primary',
        handler: async (id) => {
          console.log('Custom action for:', id);
        },
      },
    ],
    metadata: {
      proposalId: '123',
      customData: 'value',
    },
  });
}
```

## Types

### Notification
```typescript
interface Notification {
  id: string;
  category: 'proposals' | 'approvals' | 'system';
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'unread' | 'read';
  title: string;
  message: string;
  timestamp: number;
  actions?: NotificationAction[];
  metadata?: Record<string, unknown>;
}
```

### NotificationAction
```typescript
interface NotificationAction {
  id: string;
  label: string;
  type: 'approve' | 'view' | 'dismiss' | 'custom';
  variant?: 'primary' | 'secondary' | 'danger';
  handler?: (notificationId: string) => void | Promise<void>;
}
```

## Accessibility

- **ARIA Roles**: Proper roles for dialog, list, and article elements
- **Keyboard Navigation**: Full keyboard support with focus trap
- **Screen Readers**: Descriptive labels and live regions
- **Focus Management**: Automatic focus management when opening/closing
- **Escape Key**: Close panel with Escape key
- **Tab Navigation**: Proper tab order through all interactive elements

## Mobile Features

- **Swipe Gestures**: Swipe left to dismiss notifications
- **Touch Optimized**: Large touch targets (min 44px)
- **Responsive Layout**: Full-width on mobile, sidebar on desktop
- **Visual Feedback**: Swipe progress indicator
- **Performance**: Virtualization-ready for large lists

## Performance

- **Pagination**: Only render 20 notifications at a time
- **Memoization**: Filtered and sorted lists are memoized
- **Storage Limit**: Max 500 notifications in localStorage
- **Efficient Updates**: Optimized re-renders with React hooks
- **Lazy Loading**: Components load only when needed

## Testing

Run tests with:
```bash
npm test NotificationCenter
npm test NotificationItem
npm test NotificationContext
```

Tests cover:
- Component rendering
- State management
- Filtering and sorting
- Actions and handlers
- Persistence
- Accessibility
- User interactions

## Demo

Use the `NotificationDemo` component to test the notification system:

```typescript
import NotificationDemo from './components/NotificationDemo';

// Add to any page for testing
<NotificationDemo />
```

## Integration Examples

### Proposal Submission
```typescript
const handleProposalSubmit = async (proposal) => {
  try {
    await submitProposal(proposal);
    notifyProposal(
      'Proposal Submitted',
      `Proposal "${proposal.title}" has been submitted successfully`,
      [
        {
          id: 'view',
          label: 'View Proposal',
          type: 'view',
          variant: 'primary',
          handler: async () => {
            navigate(`/proposals/${proposal.id}`);
          },
        },
      ]
    );
  } catch (error) {
    notifyCritical('Submission Failed', error.message, 'proposals');
  }
};
```

### Transaction Approval
```typescript
const handleTransactionCreated = (transaction) => {
  notifyApproval(
    'Approval Required',
    `Transaction #${transaction.id} requires your signature`,
    [
      {
        id: 'approve',
        label: 'Sign Now',
        type: 'approve',
        variant: 'primary',
        handler: async (notificationId) => {
          await signTransaction(transaction.id);
          markAsRead(notificationId);
        },
      },
      {
        id: 'view',
        label: 'View Details',
        type: 'view',
        variant: 'secondary',
        handler: async () => {
          navigate(`/transactions/${transaction.id}`);
        },
      },
    ]
  );
};
```

### System Alerts
```typescript
const handleSystemEvent = (event) => {
  const priority = event.severity === 'critical' ? 'critical' : 'normal';
  notifySystem(event.title, event.message, priority);
};
```

## Customization

### Adding New Categories
1. Update `NotificationCategory` type in `types/notification.ts`
2. Add icon mapping in `NotificationItem.tsx` (`getCategoryIcon`)
3. Add color mapping in `NotificationItem.tsx` (`getCategoryColor`)
4. Update filter options in `NotificationCenter.tsx`

### Adding New Priorities
1. Update `NotificationPriority` type in `types/notification.ts`
2. Add icon mapping in `NotificationItem.tsx` (`getPriorityIcon`)
3. Add style mapping in `NotificationItem.tsx` (`getPriorityStyles`)
4. Update sort order in `NotificationCenter.tsx`

### Custom Action Types
1. Update `NotificationAction['type']` in `types/notification.ts`
2. Add icon mapping in `NotificationActions.tsx` (`getActionIcon`)
3. Implement custom handler logic

## Best Practices

1. **Use Appropriate Priorities**: Reserve 'critical' for urgent issues only
2. **Provide Actions**: Include relevant actions for user engagement
3. **Clear Messages**: Keep titles short, messages descriptive
4. **Handle Errors**: Always catch and handle action errors
5. **Clean Up**: Dismiss or mark as read after action completion
6. **Test Accessibility**: Verify keyboard navigation and screen reader support
7. **Monitor Storage**: Be aware of the 500 notification limit
8. **Optimize Actions**: Keep action handlers lightweight and fast

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (iOS 13+)
- Mobile browsers: Full support with touch gestures

## Known Limitations

- Maximum 500 notifications stored in localStorage
- Swipe gestures only work on touch devices
- Browser notifications require user permission
- LocalStorage can be cleared by user or browser

## Future Enhancements

- [ ] Push notifications via service worker
- [ ] Notification grouping/threading
- [ ] Rich media support (images, videos)
- [ ] Notification scheduling
- [ ] Export notification history
- [ ] Notification templates
- [ ] Bulk actions
- [ ] Search functionality
