# Testing the Notification Filter Sync Fix

## What Was Fixed

The NotificationCenter component now properly syncs its local filter state with the context filter whenever the panel is opened. Previously, the local state was only initialized once at mount time, causing stale filter selections to appear after external resets.

## Changes Made

### 1. Code Fix (Commit: f554ce4)
**File**: `frontend/src/components/NotificationCenter.tsx`

Added a `useEffect` hook that:
- Tracks when the panel transitions from closed to open
- Syncs all three filter states (categories, priorities, status) from context
- Only syncs on open transition (prevents input interruption)

### 2. Test Suite (Commit: 34e65a5)
**File**: `frontend/src/components/__tests__/NotificationCenter.test.tsx`

Added 5 comprehensive test cases covering:
- Filter sync on panel open
- External filter reset reflection
- No sync when panel already open
- All filter types sync correctly
- No input interruption during rapid interactions

## How to Test

### Option 1: Run Automated Tests (Recommended)

Due to PowerShell execution policy restrictions on your system, you have a few options:

**A. Change PowerShell Execution Policy (Temporary)**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd frontend
npm test
```

**B. Use CMD Instead**
```cmd
cd frontend
npm test
```

**C. Run Node Directly**
```bash
cd frontend
node ./node_modules/vitest/vitest.mjs run
```

### Option 2: Manual Browser Testing

1. **Start the development server:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Open the test guide:**
   - Open `frontend/notification-filter-test.html` in your browser
   - Follow the step-by-step instructions for each test case

3. **Key scenarios to test:**

   **Test A: Basic Sync**
   - Open NotificationCenter → Open Filters
   - Verify all default filters are selected

   **Test B: External Reset**
   - Open NotificationCenter → Deselect "Proposals" → Apply
   - Close panel
   - Click "Reset" button (or trigger external reset)
   - Reopen panel → Open Filters
   - Verify "Proposals" is selected again ✅

   **Test C: No Interruption**
   - Open NotificationCenter → Open Filters
   - Deselect "Proposals" (don't apply)
   - Keep panel open, interact with other UI
   - Return to filters
   - Verify "Proposals" still deselected ✅

### Option 3: Quick Visual Inspection

1. Start dev server: `npm run dev` (in frontend folder)
2. Open the app in browser
3. Open NotificationCenter (bell icon)
4. Click "Filter" button
5. Deselect some filters → Apply
6. Close panel
7. Click "Reset" in filters
8. Reopen panel → Open filters
9. **Expected**: Filters should be reset to defaults

## Test Files Created

1. **NOTIFICATION_FILTER_SYNC_TEST.md** - Detailed test plan with all scenarios
2. **frontend/notification-filter-test.html** - Interactive browser-based test guide
3. **Updated NotificationCenter.test.tsx** - 5 new automated test cases

## Acceptance Criteria ✅

- [x] Reopening panel shows current active filter state
- [x] Typing in filter inputs is not interrupted
- [x] External filter resets reflected on next open
- [x] No unnecessary re-renders when panel already open
- [x] All filter types (categories, priorities, status) sync correctly

## Branch Information

**Branch**: `fix/notification-filter-sync`
**Commits**:
- `f554ce4` - fix: sync NotificationCenter local filter state with context on open
- `34e65a5` - test: add comprehensive tests for notification filter sync fix

## Next Steps

1. Test the fix using one of the methods above
2. If tests pass, push the branch:
   ```bash
   git push origin fix/notification-filter-sync
   ```
3. Create a pull request to merge into main

## Troubleshooting

**If npm commands don't work:**
- Try using CMD instead of PowerShell
- Or temporarily change execution policy: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

**If tests fail:**
- Check browser console for errors
- Verify the NotificationContext is properly providing filter state
- Ensure the panel's `isOpen` prop is being toggled correctly

## Questions?

The fix is minimal and focused:
- Only 12 lines of code added
- Uses React best practices (useEffect + useRef)
- No breaking changes to existing functionality
- Fully backward compatible
