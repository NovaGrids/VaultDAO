# Migrating from Toast Notifications to Notification Center

This guide helps you migrate existing toast notifications to the new notification center system.

## Why Migrate?

The notification center provides:
- Persistent history (toasts disappear after 5 seconds)
- Actionable notifications (approve, view, dismiss)
- Categorization and filtering
- Priority-based organization
- Mobile-optimized experience
- Better accessibility

## When to Use Each System

### Use Notification Center For:
- ✅ Important events that need user action
- ✅ Events users might want to review later
- ✅ Approval requests
- ✅ Proposal updates
- ✅ Transaction status changes
- ✅ System alerts
- ✅ Events with multiple actions

### Keep Toast Notifications For:
- ✅ Quick feedback (copy to clipboard, save success)
- ✅ Temporary status updates
- ✅ Non-critical information
- ✅ Progress indicators
- ✅ Simple confirmations

## Migration Examples

### Before: Simple Toast
```typescript
import { useToast } from '../hooks/useToast';

function MyComponent() {
  const { showToast } = useToast();
  
  const handleAction = () => {
    showToast('Proposal submitted successfully', 'success');
  };
}
```

### After: Notification with Action
```typescript
import { useNotificationCenter } from '../hooks/useNotificationCenter';

function MyComponent() {
  const { notifyProposal } = useNotificationCenter();
  const navigate = useNavigate();
  
  const handleAction = (proposalId: string, title: string) => {
    notifyProposal(
      'Proposal Submitted',
      `"${title}" has been submitted for review`,
      [
        {
          id: 'view',
          label: 'View Proposal',
          type: 'view',
          variant: 'primary',
          handler: async () => {
            navigate(`/proposals/${proposalId}`);
          },
        },
      ]
    );
  };
}
```

### Before: Error Toast
```typescript
const { showToast } = useToast();

try {
  await submitProposal(data);
  showToast('Success!', 'success');
} catch (error) {
  showToast('Failed to submit proposal', 'error');
}
```

### After: Error Notification
```typescript
const { notifyProposal, notifyCritical } = useNotificationCenter();

try {
  const result = await submitProposal(data);
  notifyProposal('Proposal Submitted', 'Your proposal is now under review');
} catch (error) {
  notifyCritical(
    'Submission Failed',
    error instanceof Error ? error.message : 'Failed to submit proposal',
    'proposals'
  );
}
```

### Before: Approval Toast
```typescript
const { showToast } = useToast();

showToast('Approval required for transaction', 'warning');
```

### After: Approval Notification with Action
```typescript
const { notifyApproval } = useNotificationCenter();

notifyApproval(
  'Approval Required',
  'Transaction #12345 needs your signature',
  [
    {
      id: 'approve',
      label: 'Sign Now',
      type: 'approve',
      variant: 'primary',
      handler: async (notificationId) => {
        await signTransaction();
        // Notification automatically marked as read after action
      },
    },
    {
      id: 'view',
      label: 'View Details',
      type: 'view',
      variant: 'secondary',
      handler: async () => {
        navigate('/transactions/12345');
      },
    },
  ]
);
```

## Hybrid Approach (Recommended)

Use both systems together for the best user experience:

```typescript
import { useToast } from '../hooks/useToast';
import { useNotificationCenter } from '../hooks/useNotificationCenter';

function MyComponent() {
  const { showToast } = useToast();
  const { notifyProposal } = useNotificationCenter();
  
  const handleSubmit = async (data) => {
    try {
      const result = await submitProposal(data);
      
      // Immediate feedback with toast
      showToast('Proposal submitted!', 'success');
      
      // Persistent notification with action
      notifyProposal(
        'Proposal Submitted',
        `"${data.title}" is now under review`,
        [
          {
            id: 'view',
            label: 'View Proposal',
            type: 'view',
            variant: 'primary',
            handler: async () => navigate(`/proposals/${result.id}`),
          },
        ]
      );
    } catch (error) {
      // Error feedback
      showToast('Submission failed', 'error');
      notifyCritical('Submission Failed', error.message, 'proposals');
    }
  };
}
```

## Common Patterns

### Pattern 1: Copy to Clipboard
```typescript
// Keep as toast - immediate feedback, no action needed
const { showToast } = useToast();
showToast('Copied to clipboard', 'success');
```

### Pattern 2: Proposal Created
```typescript
// Use notification - user might want to view later
const { notifyProposal } = useNotificationCenter();
notifyProposal('Proposal Created', 'Review and approve when ready', [
  { id: 'view', label: 'View', type: 'view', variant: 'primary' }
]);
```

### Pattern 3: Transaction Complete
```typescript
// Use both - immediate feedback + history
const { showToast } = useToast();
const { notifySystem } = useNotificationCenter();

showToast('Transaction complete', 'success');
notifySystem('Transaction Complete', `Transaction #${id} executed successfully`, 'high');
```

### Pattern 4: Form Validation
```typescript
// Keep as toast - temporary, no action needed
const { showToast } = useToast();
showToast('Please fill in all required fields', 'warning');
```

### Pattern 5: Network Error
```typescript
// Use notification - user might need to retry later
const { notifyCritical } = useNotificationCenter();
notifyCritical(
  'Network Error',
  'Unable to connect. Please check your connection.',
  'system'
);
```

## Migration Checklist

- [ ] Identify all toast usage in your codebase
- [ ] Categorize by importance and need for action
- [ ] Migrate important events to notification center
- [ ] Keep simple feedback as toasts
- [ ] Add actions to notifications where appropriate
- [ ] Test both systems work together
- [ ] Update error handling to use notifications
- [ ] Add notifications to approval flows
- [ ] Test mobile experience
- [ ] Verify accessibility

## Search and Replace Patterns

### Find Toast Usage
```bash
# Search for toast usage
grep -r "showToast" frontend/src/
grep -r "useToast" frontend/src/
```

### Common Replacements

1. **Success Messages**
   - Before: `showToast('Success', 'success')`
   - After: `notifySystem('Success', 'Operation completed', 'normal')`

2. **Error Messages**
   - Before: `showToast('Error', 'error')`
   - After: `notifyCritical('Error', 'Operation failed', 'system')`

3. **Warning Messages**
   - Before: `showToast('Warning', 'warning')`
   - After: `notifySystem('Warning', 'Please review', 'high')`

## Testing After Migration

1. **Verify Notifications Appear**
   - Click bell icon to see notifications
   - Check unread count updates
   - Verify notifications persist

2. **Test Actions**
   - Click action buttons
   - Verify handlers execute
   - Check notifications mark as read

3. **Test Filtering**
   - Filter by category
   - Filter by priority
   - Filter by read/unread

4. **Test Mobile**
   - Swipe to dismiss
   - Check responsive layout
   - Verify touch targets

5. **Test Persistence**
   - Reload page
   - Check notifications remain
   - Verify localStorage works

## Gradual Migration Strategy

1. **Phase 1: Critical Paths**
   - Migrate approval requests
   - Migrate proposal submissions
   - Migrate transaction completions

2. **Phase 2: Important Events**
   - Migrate system alerts
   - Migrate error notifications
   - Migrate status changes

3. **Phase 3: Nice-to-Have**
   - Migrate informational messages
   - Add actions to existing notifications
   - Enhance with metadata

4. **Phase 4: Optimization**
   - Remove redundant toasts
   - Optimize notification frequency
   - Add notification grouping

## Best Practices

1. **Don't Over-Notify**
   - Not every action needs a notification
   - Group related events when possible
   - Use appropriate priority levels

2. **Provide Clear Actions**
   - Every notification should have a purpose
   - Add relevant actions when possible
   - Make action labels clear and concise

3. **Use Appropriate Categories**
   - proposals: Proposal-related events
   - approvals: Signature/approval requests
   - system: System messages and errors

4. **Set Correct Priorities**
   - critical: Security issues, errors
   - high: Approvals, important proposals
   - normal: Standard notifications
   - low: Informational messages

5. **Handle Errors Gracefully**
   - Always catch action handler errors
   - Provide feedback on action failure
   - Don't leave users in unknown state

## Support

If you encounter issues during migration:

1. Check the documentation: `frontend/src/components/NOTIFICATION_CENTER.md`
2. Review examples: `frontend/src/examples/NotificationIntegration.tsx`
3. Test with demo: `frontend/src/components/NotificationDemo.tsx`
4. Check TypeScript types: `frontend/src/types/notification.ts`

## Conclusion

The notification center and toast system complement each other. Use toasts for immediate, temporary feedback and notifications for important, actionable events that users might want to review later.

Start with critical paths and gradually migrate other areas as needed. Both systems can coexist peacefully in your application.
