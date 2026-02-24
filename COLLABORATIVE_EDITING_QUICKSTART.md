# Collaborative Proposal Editing - Quick Start Guide

## 🚀 Quick Start (5 minutes)

### 1. Install Dependencies (Already Done)
```bash
cd frontend
npm install
```

### 2. Configure Environment
Create `frontend/.env`:
```env
VITE_COLLAB_WS_URL=ws://localhost:1234
```

### 3. Start WebSocket Server
Open a new terminal:
```bash
cd frontend
npm run collab-server
```

You should see:
```
WebSocket server running on ws://localhost:1234
Ready for collaborative editing connections
```

### 4. Start Development Server
In another terminal:
```bash
cd frontend
npm run dev
```

### 5. Test Collaborative Editing

Open two browser windows side-by-side:
- Window 1: http://localhost:5173
- Window 2: http://localhost:5173 (incognito/private mode)

Click "Create Collaborative Draft" in both windows and start editing!

## 📝 Basic Usage

### Option 1: Use the Complete Modal

```tsx
import CollaborativeProposalModal from './components/modals/CollaborativeProposalModal';

<CollaborativeProposalModal
  isOpen={true}
  draftId="draft-123"
  userId="user-456"
  userName="Alice"
  initialData={{ recipient: '', token: 'NATIVE', amount: '', memo: '' }}
  loading={false}
  onClose={() => {}}
  onSubmit={(data) => console.log(data)}
/>
```

### Option 2: Add to Existing Modal

```tsx
import NewProposalModal from './components/modals/NewProposalModal';

<NewProposalModal
  // ... existing props
  onEnableCollaboration={() => {
    const draftId = `draft-${Date.now()}`;
    setShowCollabModal(true);
  }}
/>
```

## 🎯 Key Features

### Real-time Editing
- Multiple users edit simultaneously
- Changes sync instantly
- See who's online with colored avatars

### Version History
- Click "Version History" tab
- Compare any two versions
- Restore previous versions with one click

### Change Tracking
- Click "Change Tracking" tab
- Filter by user or field
- See complete change timeline

### Auto-save
- Saves every 30 seconds automatically
- Shows "Saved X ago" indicator
- No manual save needed

## 🔧 Integration Example

See `frontend/src/examples/CollaborativeProposalExample.tsx` for a complete working example.

## 📱 Mobile Testing

Open on your phone:
1. Find your local IP: `ifconfig` or `ipconfig`
2. Update WebSocket URL: `ws://YOUR_IP:1234`
3. Open `http://YOUR_IP:5173` on phone

## 🐛 Troubleshooting

### "Disconnected" status
- Check WebSocket server is running
- Verify `VITE_COLLAB_WS_URL` in `.env`
- Check browser console for errors

### Changes not syncing
- Ensure both users use same `draftId`
- Check WebSocket server logs
- Verify network connectivity

### Version history empty
- Make some changes first
- Wait for auto-save (30 seconds)
- Or manually trigger save

## 📚 Documentation

- Full docs: `COLLABORATIVE_EDITING_IMPLEMENTATION.md`
- Component docs: `frontend/src/components/collaborative/README.md`
- Example: `frontend/src/examples/CollaborativeProposalExample.tsx`

## 🎨 Customization

### Change auto-save interval
```typescript
// In useCollaboration.ts
const AUTO_SAVE_INTERVAL = 30000; // Change to desired milliseconds
```

### Change user colors
```typescript
// In useCollaboration.ts
const colors = [
  '#FF6B6B', '#4ECDC4', // Add your colors
];
```

### Change version/change limits
```typescript
// In useVersionHistory.ts
const MAX_VERSIONS = 50; // Change limit

// In useChangeTracking.ts
const MAX_CHANGES = 100; // Change limit
```

## ✅ Testing Checklist

- [ ] Two users can edit simultaneously
- [ ] Changes appear in real-time
- [ ] User avatars show online status
- [ ] Version history records changes
- [ ] Diff view shows differences
- [ ] Version restore works
- [ ] Change tracking shows all edits
- [ ] Auto-save works
- [ ] Mobile layout is responsive

## 🚢 Production Deployment

### WebSocket Server
Deploy to a server (e.g., AWS, Heroku, DigitalOcean):

```bash
# Install dependencies
npm install ws y-websocket

# Run server
node collab-server.js
```

### Environment Variables
Update production `.env`:
```env
VITE_COLLAB_WS_URL=wss://your-collab-server.com
```

### Security (Important!)
- Add authentication to WebSocket server
- Use WSS (secure WebSocket) in production
- Implement rate limiting
- Add access control for drafts

## 💡 Tips

1. **Unique Draft IDs**: Use `draft-${Date.now()}-${userId}` for unique IDs
2. **User Names**: Use wallet address or username for identification
3. **Testing**: Open multiple browser windows to test collaboration
4. **Mobile**: Test on actual devices for best results
5. **Performance**: Limit to 5-10 concurrent users per draft

## 🆘 Need Help?

1. Check browser console for errors
2. Check WebSocket server logs
3. Review documentation in `COLLABORATIVE_EDITING_IMPLEMENTATION.md`
4. Check example in `frontend/src/examples/CollaborativeProposalExample.tsx`

## 🎉 You're Ready!

Start creating collaborative proposals and enjoy real-time editing with your team!
