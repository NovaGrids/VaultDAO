# Real-Time Collaboration - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Start WebSocket Server

```bash
cd websocket-server
npm install
npm start
```

You should see:
```
🚀 WebSocket server running on ws://localhost:8080
📝 Waiting for connections...
```

### Step 2: Configure Frontend

```bash
cd frontend
cp .env.example .env
```

The `.env` file should contain:
```env
VITE_WS_URL=ws://localhost:8080
```

### Step 3: Start Frontend

```bash
npm install  # If not already installed
npm run dev
```

### Step 4: Test Real-Time Features

1. **Open two browser windows** (or use incognito mode)
2. **Connect wallet** in both windows
3. **Navigate to Proposals** page
4. **View a proposal** in both windows
5. **Approve in one window** → See live update in the other!

## ✅ What You Should See

### Connection Status
- Green dot in header = Connected
- Yellow dot = Connecting
- Red dot = Error

### Presence Indicators
- User avatars showing who's viewing
- Typing indicators in comments
- Active user count

### Live Updates
- Approval notifications
- Execution alerts
- Comment activity
- Conflict warnings

## 🐛 Troubleshooting

### WebSocket Won't Connect

**Check server is running:**
```bash
curl http://localhost:8080
```

**Check browser console:**
- Press F12
- Look for WebSocket errors
- Verify wallet is connected

### No Live Updates

**Verify WebSocket connection:**
- Check green dot in header
- Open DevTools → Network → WS tab
- Should see active WebSocket connection

**Check .env file:**
```env
VITE_WS_URL=ws://localhost:8080  # Must match server
```

### Presence Not Showing

**Refresh the page:**
- Sometimes presence needs a refresh
- Check multiple users are connected
- Verify they're viewing the same proposal

## 📱 Mobile Testing

### Chrome DevTools
1. Press F12
2. Click device toolbar icon (Ctrl+Shift+M)
3. Select device (iPhone, iPad, etc.)
4. Test all features

### Real Device
1. Find your local IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Update .env: `VITE_WS_URL=ws://192.168.1.x:8080`
3. Access from mobile: `http://192.168.1.x:5173`

## 🎯 Key Features to Test

### 1. Presence Indicators
- [ ] Open proposal in two browsers
- [ ] See both users in presence list
- [ ] Close one browser
- [ ] User disappears from list

### 2. Live Approvals
- [ ] Approve proposal in browser 1
- [ ] See notification in browser 2
- [ ] Approval count updates immediately
- [ ] Status badge changes

### 3. Typing Indicators
- [ ] Open comments in two browsers
- [ ] Start typing in browser 1
- [ ] See "typing..." in browser 2
- [ ] Stop typing
- [ ] Indicator disappears after 2s

### 4. Optimistic Updates
- [ ] Throttle network in DevTools
- [ ] Approve proposal
- [ ] See immediate UI update
- [ ] Wait for confirmation
- [ ] Success or rollback

### 5. Connection Status
- [ ] Check green dot when connected
- [ ] Go offline (DevTools)
- [ ] See red dot and warning
- [ ] Go online
- [ ] Auto-reconnects

## 📚 Next Steps

### Learn More
- Read **REALTIME_COLLABORATION_GUIDE.md** for comprehensive guide
- Check **REALTIME_COLLABORATION_IMPLEMENTATION.md** for technical details
- Review **REALTIME_FEATURE_SUMMARY.md** for complete feature list

### Production Deployment
1. Deploy WebSocket server to cloud
2. Use WSS (secure WebSocket)
3. Update VITE_WS_URL to production URL
4. Add authentication
5. Set up monitoring

### Customize
- Modify message types in `frontend/src/types/websocket.ts`
- Add handlers in `WebSocketProvider.tsx`
- Create new UI components
- Update server in `websocket-server/server.js`

## 🆘 Need Help?

### Common Issues

**Port 8080 already in use:**
```bash
# Use different port
PORT=8081 npm start

# Update .env
VITE_WS_URL=ws://localhost:8081
```

**CORS errors:**
- WebSocket server allows all origins by default
- For production, configure CORS properly

**TypeScript errors:**
```bash
# Rebuild
npm run build
```

**Connection keeps dropping:**
- Check firewall settings
- Verify network stability
- Check server logs for errors

### Debug Mode

Enable logging in `WebSocketProvider.tsx`:
```typescript
const DEBUG = true;  // Line 15
```

Check browser console for detailed logs.

## 🎉 Success!

If you can see:
- ✅ Green connection indicator
- ✅ User avatars in presence list
- ✅ Live updates when approving
- ✅ Typing indicators in comments

**Congratulations! Real-time collaboration is working!** 🎊

---

**Time to complete**: ~5 minutes
**Difficulty**: Easy
**Prerequisites**: Node.js, npm, browser
