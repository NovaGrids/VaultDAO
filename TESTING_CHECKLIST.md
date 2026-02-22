# Proposal List Feature - Testing Checklist

## Prerequisites
- [ ] Contract deployed to testnet
- [ ] `.env` file configured with correct `VITE_CONTRACT_ADDRESS`
- [ ] Freighter wallet installed and connected
- [ ] Test proposals created in the contract

## Functional Testing

### Data Fetching
- [ ] Proposals load automatically on page mount
- [ ] Loading spinner displays while fetching
- [ ] Proposals display after successful fetch
- [ ] Error message shows if fetch fails
- [ ] Retry button works in error state
- [ ] Refresh button refetches data

### Proposal Display
- [ ] All proposal fields display correctly:
  - [ ] Proposal ID (e.g., "Proposal #0")
  - [ ] Status badge with correct color
  - [ ] Proposer address (truncated)
  - [ ] Recipient address (truncated)
  - [ ] Amount formatted with XLM
  - [ ] Created ledger number
  - [ ] Unlock time (if timelocked)
  - [ ] Description (if present)

### Status Filtering
- [ ] "All" filter shows all proposals
- [ ] "Pending" filter shows only pending proposals
- [ ] "Approved" filter shows only approved proposals
- [ ] "Executed" filter shows only executed proposals
- [ ] "Rejected" filter shows only rejected proposals
- [ ] "Expired" filter shows only expired proposals
- [ ] Filter counts are accurate
- [ ] Active filter is visually highlighted

### Status Badge Colors
- [ ] Pending: Amber/Yellow
- [ ] Approved: Cyan/Blue
- [ ] Executed: Green/Emerald
- [ ] Rejected: Red/Rose
- [ ] Expired: Gray/Slate

### Empty State
- [ ] Shows when no proposals exist
- [ ] Displays helpful message
- [ ] "Create your first proposal" button present
- [ ] Shows when filter returns no results

### Error Handling
- [ ] Network errors display user-friendly message
- [ ] Contract not found error handled
- [ ] Invalid contract address handled
- [ ] Wallet not connected handled gracefully

## Responsive Design Testing

### Mobile (320px - 767px)
- [ ] Single column layout
- [ ] Cards stack vertically
- [ ] All content readable
- [ ] Touch targets adequate (44px min)
- [ ] Filter buttons wrap properly
- [ ] No horizontal scroll

### Tablet (768px - 1023px)
- [ ] Two column grid
- [ ] Cards display side-by-side
- [ ] Spacing appropriate
- [ ] Filter tabs fit on one line

### Desktop (1024px+)
- [ ] Three column grid
- [ ] Cards evenly distributed
- [ ] Hover states work
- [ ] Focus states visible

## Accessibility Testing

### Keyboard Navigation
- [ ] Tab through filter buttons
- [ ] Tab through proposal cards
- [ ] Enter/Space activates filters
- [ ] Focus indicators visible
- [ ] Logical tab order

### Screen Reader
- [ ] Filter buttons announce state (pressed/not pressed)
- [ ] Proposal cards have semantic structure
- [ ] Status badges announce correctly
- [ ] Loading state announced
- [ ] Error messages announced

### Visual
- [ ] Sufficient color contrast (WCAG AA)
- [ ] Text readable at 200% zoom
- [ ] No information conveyed by color alone

## Performance Testing
- [ ] Initial load < 3 seconds
- [ ] Filter changes instant
- [ ] No layout shift during load
- [ ] Smooth animations/transitions
- [ ] No console errors
- [ ] No console warnings

## Edge Cases
- [ ] Zero proposals
- [ ] One proposal
- [ ] 100+ proposals
- [ ] Very long addresses
- [ ] Very large amounts
- [ ] Missing optional fields (description, unlockTime)
- [ ] Rapid filter switching
- [ ] Multiple rapid refreshes
- [ ] Wallet disconnection during fetch

## Browser Compatibility
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

## Integration Testing
- [ ] Works with WalletContext
- [ ] Works with Soroban RPC
- [ ] Handles contract storage format variations
- [ ] Parses all proposal fields correctly
- [ ] BigInt amounts handled correctly

## Code Quality
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Proper error boundaries
- [ ] Console logs removed (except errors)
- [ ] Comments where needed
- [ ] Consistent code style

## Documentation
- [ ] Code comments explain complex logic
- [ ] README updated (if needed)
- [ ] API documentation accurate
- [ ] Environment variables documented

## Git Workflow
- [ ] Branch created from main
- [ ] Commits follow convention
- [ ] No merge conflicts
- [ ] PR description complete
- [ ] Screenshots included

## Notes
- Test with real contract data on testnet
- Verify all storage key formats work
- Check console for any warnings
- Test with slow network (throttling)
