# Collaborative Proposal Editing

This module implements real-time collaborative editing for proposal drafts with conflict resolution, version history, and change tracking.

## Features

- **Real-time Collaborative Editing**: Multiple users can edit proposals simultaneously using CRDT (Conflict-free Replicated Data Types) via Yjs
- **Conflict Detection & Resolution**: Automatic conflict detection and resolution using operational transformation
- **Version History**: Complete version history with diff view for comparing changes
- **Change Tracking**: Track all changes by user with detailed history
- **Auto-save**: Automatic saving every 30 seconds
- **Version Restore**: Restore any previous version
- **Mobile Responsive**: Fully responsive design for mobile and desktop

## Components

### CollaborativeEditor
Main editor component with real-time synchronization.

```tsx
import CollaborativeEditor from './components/collaborative/CollaborativeEditor';

<CollaborativeEditor
  draftId="draft-123"
  userId="user-456"
  userName="Alice"
  initialData={formData}
  onDataChange={setFormData}
  onSave={handleSave}
/>
```

### VersionHistory
Version history viewer with diff comparison.

```tsx
import VersionHistory from './components/collaborative/VersionHistory';

<VersionHistory
  draftId="draft-123"
  onRestore={handleRestore}
/>
```

### ChangeTracker
Change tracking component showing user contributions.

```tsx
import ChangeTracker from './components/collaborative/ChangeTracker';

<ChangeTracker draftId="draft-123" />
```

### CollaborativeProposalModal
Complete modal integrating all collaborative features.

```tsx
import CollaborativeProposalModal from './components/modals/CollaborativeProposalModal';

<CollaborativeProposalModal
  isOpen={isOpen}
  draftId="draft-123"
  userId="user-456"
  userName="Alice"
  initialData={formData}
  loading={loading}
  onClose={handleClose}
  onSubmit={handleSubmit}
/>
```

## Setup

### 1. Install Dependencies

```bash
npm install yjs y-websocket react-diff-viewer-continued
```

### 2. Configure WebSocket Server

Set the WebSocket URL in your environment variables:

```env
VITE_COLLAB_WS_URL=ws://localhost:1234
```

### 3. WebSocket Server Setup (Optional)

For production, you'll need a WebSocket server. Example using y-websocket:

```javascript
// server.js
const WebSocket = require('ws');
const http = require('http');
const { setupWSConnection } = require('y-websocket/bin/utils');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', setupWSConnection);

server.listen(1234, () => {
  console.log('WebSocket server running on port 1234');
});
```

## Usage in Proposals Component

```tsx
import { useState } from 'react';
import CollaborativeProposalModal from './components/modals/CollaborativeProposalModal';
import { useWallet } from './context/WalletContextProps';

function Proposals() {
  const { address } = useWallet();
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [draftId, setDraftId] = useState('');

  const handleEnableCollaboration = () => {
    const newDraftId = `draft-${Date.now()}`;
    setDraftId(newDraftId);
    setShowCollabModal(true);
  };

  return (
    <>
      <button onClick={handleEnableCollaboration}>
        Create Collaborative Draft
      </button>

      <CollaborativeProposalModal
        isOpen={showCollabModal}
        draftId={draftId}
        userId={address || 'anonymous'}
        userName={address?.slice(0, 8) || 'Anonymous'}
        initialData={formData}
        loading={loading}
        onClose={() => setShowCollabModal(false)}
        onSubmit={handleSubmit}
      />
    </>
  );
}
```

## Storage

- **Version History**: Stored in localStorage with key `draft_versions_{draftId}`
- **Change Tracking**: Stored in localStorage with key `draft_changes_{draftId}`
- **CRDT State**: Synchronized via WebSocket, not persisted locally

## Hooks

### useCollaboration
Manages real-time collaboration state.

```tsx
const {
  isConnected,
  collaborators,
  hasConflict,
  updateField,
  getField,
  updateCursor,
} = useCollaboration({
  draftId,
  userId,
  userName,
  onSync: (draft) => console.log('Synced:', draft),
});
```

### useVersionHistory
Manages version history and restoration.

```tsx
const {
  versions,
  saveVersion,
  restoreVersion,
  getDiff,
  clearVersions,
} = useVersionHistory(draftId);
```

### useChangeTracking
Tracks user changes.

```tsx
const {
  changes,
  trackChange,
  getChangesByUser,
  getChangesByField,
  getRecentChanges,
} = useChangeTracking(draftId);
```

## Mobile Responsiveness

All components are fully responsive:
- Stacked layout on mobile (< 640px)
- Side-by-side layout on tablet and desktop
- Touch-friendly buttons (min 44px height)
- Scrollable content areas
- Collapsible sections on mobile

## Conflict Resolution

The system uses CRDTs (Yjs) for automatic conflict resolution:
1. Each field is a shared Y.Text type
2. Changes are automatically merged using operational transformation
3. Conflicts are detected when multiple users edit the same field within 5 seconds
4. A warning is shown to users when conflicts are detected
5. All changes are preserved and merged automatically

## Performance

- Auto-save throttled to 30 seconds
- Version history limited to 50 versions
- Change tracking limited to 100 changes
- WebSocket reconnection on disconnect
- Efficient diff calculation using react-diff-viewer

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Full support

## Security Considerations

- User authentication should be handled by your auth system
- WebSocket connections should use WSS in production
- Validate all user inputs before submission
- Sanitize user names and content to prevent XSS
