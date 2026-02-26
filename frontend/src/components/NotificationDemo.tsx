import React from 'react';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { Bell, FileText, CheckCircle, AlertTriangle } from 'lucide-react';

/**
 * Demo component showing how to use the notification center
 * This can be removed in production or used for testing
 */
const NotificationDemo: React.FC = () => {
  const {
    notify,
    notifyProposal,
    notifyApproval,
    notifySystem,
    notifyCritical,
  } = useNotificationCenter();

  const handleBasicNotification = () => {
    notify('Basic Notification', 'This is a basic notification message');
  };

  const handleProposalNotification = () => {
    notifyProposal(
      'New Proposal Submitted',
      'A new proposal "Update Treasury Allocation" has been submitted for review',
      [
        {
          id: 'view-proposal',
          label: 'View Proposal',
          type: 'view',
          variant: 'primary',
          handler: async (id) => {
            console.log('Viewing proposal from notification:', id);
            // Navigate to proposal page
          },
        },
        {
          id: 'dismiss',
          label: 'Dismiss',
          type: 'dismiss',
          variant: 'secondary',
        },
      ]
    );
  };

  const handleApprovalNotification = () => {
    notifyApproval(
      'Approval Required',
      'Your signature is required for transaction #12345',
      [
        {
          id: 'approve',
          label: 'Approve',
          type: 'approve',
          variant: 'primary',
          handler: async (id) => {
            console.log('Approving from notification:', id);
            // Handle approval logic
          },
        },
        {
          id: 'view-details',
          label: 'View Details',
          type: 'view',
          variant: 'secondary',
        },
      ]
    );
  };

  const handleSystemNotification = () => {
    notifySystem('System Maintenance', 'Scheduled maintenance will occur tonight at 2 AM UTC');
  };

  const handleCriticalNotification = () => {
    notifyCritical(
      'Security Alert',
      'Unusual activity detected on your account. Please review immediately.',
      'system'
    );
  };

  const handleMultipleNotifications = () => {
    notifyProposal('Proposal #1', 'First proposal notification');
    setTimeout(() => notifyApproval('Approval #1', 'First approval notification'), 500);
    setTimeout(() => notifySystem('System Update', 'System has been updated'), 1000);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Bell className="text-purple-400" size={24} />
        <h2 className="text-xl font-bold text-white">Notification Center Demo</h2>
      </div>

      <p className="text-gray-400 text-sm mb-6">
        Click the buttons below to test different notification types. Open the notification center
        (bell icon in header) to see them.
      </p>

      <div className="space-y-3">
        <button
          onClick={handleBasicNotification}
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors"
        >
          <Bell size={18} className="text-blue-400" />
          <div>
            <div className="text-white font-medium">Basic Notification</div>
            <div className="text-gray-400 text-xs">Simple notification with no actions</div>
          </div>
        </button>

        <button
          onClick={handleProposalNotification}
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors"
        >
          <FileText size={18} className="text-purple-400" />
          <div>
            <div className="text-white font-medium">Proposal Notification</div>
            <div className="text-gray-400 text-xs">High priority with view action</div>
          </div>
        </button>

        <button
          onClick={handleApprovalNotification}
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors"
        >
          <CheckCircle size={18} className="text-green-400" />
          <div>
            <div className="text-white font-medium">Approval Notification</div>
            <div className="text-gray-400 text-xs">High priority with approve action</div>
          </div>
        </button>

        <button
          onClick={handleSystemNotification}
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors"
        >
          <Bell size={18} className="text-blue-400" />
          <div>
            <div className="text-white font-medium">System Notification</div>
            <div className="text-gray-400 text-xs">Normal priority system message</div>
          </div>
        </button>

        <button
          onClick={handleCriticalNotification}
          className="w-full flex items-center gap-3 px-4 py-3 bg-red-600 hover:bg-red-700 rounded-lg text-left transition-colors"
        >
          <AlertTriangle size={18} className="text-white" />
          <div>
            <div className="text-white font-medium">Critical Alert</div>
            <div className="text-red-200 text-xs">Critical priority notification</div>
          </div>
        </button>

        <button
          onClick={handleMultipleNotifications}
          className="w-full flex items-center gap-3 px-4 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg text-left transition-colors"
        >
          <Bell size={18} className="text-white" />
          <div>
            <div className="text-white font-medium">Multiple Notifications</div>
            <div className="text-purple-200 text-xs">Send 3 notifications in sequence</div>
          </div>
        </button>
      </div>

      <div className="mt-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <h3 className="text-sm font-semibold text-white mb-2">Features:</h3>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>✓ Categorization (proposals, approvals, system)</li>
          <li>✓ Priority levels (critical, high, normal, low)</li>
          <li>✓ Read/unread state tracking</li>
          <li>✓ Inline actions (approve, view, dismiss)</li>
          <li>✓ Filtering by category, priority, and status</li>
          <li>✓ Sorting by timestamp or priority</li>
          <li>✓ Pagination for large lists</li>
          <li>✓ LocalStorage persistence</li>
          <li>✓ Mobile-responsive with swipe gestures</li>
          <li>✓ Keyboard navigation and accessibility</li>
        </ul>
      </div>
    </div>
  );
};

export default NotificationDemo;
