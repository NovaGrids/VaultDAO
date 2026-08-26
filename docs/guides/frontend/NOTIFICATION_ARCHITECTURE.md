# Notification Center Architecture

## Component Hierarchy

```
App (main.tsx)
└── NotificationProvider (context)
    └── DashboardLayout
        ├── Header
        │   └── Bell Icon (with unread badge)
        │       └── onClick → opens NotificationCenter
        └── NotificationCenter (panel)
            ├── Header
            │   ├── Title + Unread Count
            │   ├── Filter Button
            │   ├── Mark All Read Button
            │   └── Clear All Button
            ├── Filter Panel (collapsible)
            │   ├── Category Filters
            │   ├── Priority Filters
            │   ├── Status Filters
            │   └── Sort Options
            ├── Notification List
            │   └── NotificationItem (repeated)
            │       ├── Category Icon
            │       ├── Priority Indicator
            │       ├── Title + Message
            │       ├── Timestamp
            │       ├── Read/Unread Indicator
            │       └── NotificationActions
            │           └── Action Buttons (approve, view, dismiss)
            └── Pagination
                ├── Previous Button
                ├── Page Info
                └── Next Button
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     NotificationProvider                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    State (useReducer)                   │ │
│  │  • notifications: Notification[]                        │ │
│  │  • filter: NotificationFilter                           │ │
│  │  • sort: NotificationSort                               │ │
│  │  • page: number                                         │ │
│  │  • pageSize: number                                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↕                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   LocalStorage                          │ │
│  │  • Auto-save on changes                                 │ │
│  │  • Auto-load on mount                                   │ │
│  │  • Max 500 notifications                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↕                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Context API                            │ │
│  │  • addNotification()                                    │ │
│  │  • markAsRead()                                         │ │
│  │  • markAllAsRead()                                      │ │
│  │  • dismissNotification()                                │ │
│  │  • setFilter()                                          │ │
│  │  • setSort()                                            │ │
│  │  • setPage()                                            │ │
│  │  • clearAll()                                           │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        ↓                                       ↓
┌──────────────────┐                  ┌──────────────────┐
│  useNotifications │                  │ useNotificationCenter │
│  (direct access)  │                  │  (convenience hook)   │
└──────────────────┘                  └──────────────────┘
        ↓                                       ↓
┌──────────────────┐                  ┌──────────────────┐
│  Components      │                  │  Components      │
│  • NotificationCenter │              │  • Your Components │
│  • NotificationItem   │              │  • Proposal Forms  │
│  • NotificationActions│              │  • Transaction UI  │
└──────────────────┘                  └──────────────────┘
```

## State Management Flow

```
User Action
    ↓
Component calls hook method
    ↓
Hook dispatches action to reducer
    ↓
Reducer updates state
    ↓
State change triggers useEffect
    ↓
Save to localStorage
    ↓
Context notifies all consumers
    ↓
Components re-render with new data
```

## Notification Lifecycle

```
1. CREATE
   Component → useNotificationCenter.notify()
   → addNotification()
   → Reducer: ADD_NOTIFICATION
   → State: notifications = [new, ...old]
   → Save to localStorage
   → UI updates

2. READ
   User clicks notification
   → NotificationItem.onClick()
   → markAsRead(id)
   → Reducer: MARK_AS_READ
   → State: notification.status = 'read'
   → Save to localStorage
   → UI updates (remove unread indicator)

3. ACTION
   User clicks action button
   → NotificationActions.handleAction()
   → action.handler(notificationId)
   → Async operation
   → onActionComplete()
   → markAsRead(notificationId)
   → UI updates

4. DISMISS
   User swipes or clicks dismiss
   → dismissNotification(id)
   → Reducer: DISMISS_NOTIFICATION
   → State: notifications = notifications.filter(n => n.id !== id)
   → Save to localStorage
   → UI updates (notification removed)

5. FILTER
   User changes filter
   → setFilter(newFilter)
   → Reducer: SET_FILTER
   → State: filter = newFilter, page = 1
   → useMemo recalculates filtered list
   → UI updates with filtered notifications

6. PERSIST
   Page reload
   → NotificationProvider mounts
   → useEffect loads from localStorage
   → Reducer: LOAD_FROM_STORAGE
   → State: notifications = stored
   → UI displays persisted notifications
```

## Component Responsibilities

### NotificationProvider
- Global state management
- LocalStorage persistence
- Action dispatching
- Context provision

### NotificationCenter
- Panel UI and layout
- Filter/sort controls
- Pagination logic
- Keyboard navigation
- Focus management

### NotificationItem
- Individual notification display
- Touch gesture handling
- Visual styling by priority
- Click to mark as read
- Timestamp formatting

### NotificationActions
- Action button rendering
- Async action handling
- Loading states
- Error handling
- Action completion callbacks

### useNotificationCenter
- Simplified API
- Type-safe notification creation
- Helper methods for common patterns
- Abstraction over context

## Type System

```typescript
// Core Types
Notification {
  id: string
  category: 'proposals' | 'approvals' | 'system'
  priority: 'critical' | 'high' | 'normal' | 'low'
  status: 'unread' | 'read'
  title: string
  message: string
  timestamp: number
  actions?: NotificationAction[]
  metadata?: Record<string, unknown>
}

NotificationAction {
  id: string
  label: string
  type: 'approve' | 'view' | 'dismiss' | 'custom'
  variant?: 'primary' | 'secondary' | 'danger'
  handler?: (notificationId: string) => void | Promise<void>
}

// State Types
NotificationFilter {
  categories: NotificationCategory[]
  priorities: NotificationPriority[]
  status?: NotificationStatus
}

NotificationSort {
  by: 'timestamp' | 'priority'
  order: 'asc' | 'desc'
}

NotificationState {
  notifications: Notification[]
  filter: NotificationFilter
  sort: NotificationSort
  page: number
  pageSize: number
}
```

## Storage Schema

```typescript
// LocalStorage Key: 'vaultdao_notifications'
// Value: JSON string of Notification[]

{
  "vaultdao_notifications": [
    {
      "id": "notif-1234567890-abc123",
      "category": "proposals",
      "priority": "high",
      "status": "unread",
      "title": "New Proposal",
      "message": "A proposal needs your review",
      "timestamp": 1234567890000,
      "actions": [
        {
          "id": "view",
          "label": "View Proposal",
          "type": "view",
          "variant": "primary"
        }
      ],
      "metadata": {
        "proposalId": "prop-123"
      }
    }
  ]
}
```

## Performance Optimizations

1. **Memoization**
   - Filtered notifications: `useMemo`
   - Paginated notifications: `useMemo`
   - Prevents unnecessary recalculations

2. **Pagination**
   - Only render 20 notifications at a time
   - Reduces DOM nodes
   - Improves scroll performance

3. **Efficient Updates**
   - useReducer for complex state
   - Batch updates automatically
   - Minimal re-renders

4. **Storage Limits**
   - Max 500 notifications
   - Prevents localStorage overflow
   - Automatic cleanup of old items

5. **Event Handlers**
   - useCallback for stable references
   - Prevents child re-renders
   - Optimized touch handlers

## Accessibility Features

1. **ARIA Attributes**
   - `role="dialog"` on panel
   - `aria-modal="true"` for modal behavior
   - `aria-label` on interactive elements
   - `aria-pressed` on toggle buttons
   - `aria-expanded` on collapsible sections

2. **Keyboard Navigation**
   - Tab through all interactive elements
   - Escape to close panel
   - Focus trap within panel
   - Automatic focus management

3. **Screen Reader Support**
   - Semantic HTML elements
   - Descriptive labels
   - Live regions for updates
   - Status announcements

4. **Visual Indicators**
   - High contrast colors
   - Clear focus states
   - Priority-based styling
   - Unread indicators

## Mobile Optimizations

1. **Touch Gestures**
   - Swipe left to dismiss
   - Visual feedback during swipe
   - Threshold-based activation

2. **Responsive Layout**
   - Full-width on mobile
   - Sidebar on desktop
   - Adaptive spacing
   - Touch-friendly targets (44px min)

3. **Performance**
   - Optimized touch handlers
   - Smooth animations
   - Efficient re-renders
   - Minimal layout shifts

## Integration Points

```
Your Component
    ↓
useNotificationCenter()
    ↓
notify() / notifyProposal() / notifyApproval()
    ↓
NotificationContext
    ↓
State Update
    ↓
NotificationCenter (if open)
    ↓
NotificationItem
    ↓
NotificationActions
    ↓
User Action
    ↓
Action Handler
    ↓
Your Business Logic
```

## Error Handling

```
Action Handler Error
    ↓
try/catch in NotificationActions
    ↓
console.error (logged)
    ↓
Loading state cleared
    ↓
User can retry
    ↓
Optional: Show error notification
```

## Testing Strategy

1. **Unit Tests**
   - Context reducer logic
   - Hook behavior
   - Utility functions

2. **Component Tests**
   - Rendering
   - User interactions
   - State updates
   - Accessibility

3. **Integration Tests**
   - Full notification flow
   - Persistence
   - Filtering/sorting
   - Actions

4. **E2E Tests**
   - User workflows
   - Cross-component interaction
   - Mobile gestures
   - Keyboard navigation

## Future Enhancements

1. **Notification Grouping**
   - Group related notifications
   - Expandable groups
   - Summary view

2. **Rich Media**
   - Images in notifications
   - Video previews
   - File attachments

3. **Push Notifications**
   - Service worker integration
   - Browser notifications
   - Permission management

4. **Advanced Filtering**
   - Date range filters
   - Search functionality
   - Custom filters

5. **Bulk Actions**
   - Select multiple
   - Batch operations
   - Mass dismiss/read

6. **Export**
   - Export history
   - CSV/JSON format
   - Date range selection

7. **Templates**
   - Notification templates
   - Quick actions
   - Customizable layouts
