# Quick Start Guide - Proposal List Feature

## TL;DR - Feature is Already Implemented! ✅

The proposal list feature is **complete and ready to use**. This guide helps you verify and test it.

## 5-Minute Setup

### 1. Install Dependencies
```bash
cd VaultDAO/frontend
npm install
```

### 2. Configure Environment
Edit `frontend/.env`:
```bash
VITE_CONTRACT_ADDRESS=your_deployed_contract_address_here
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Open Browser
Navigate to: `http://localhost:5173`

### 5. Connect Wallet
Click "Connect Wallet" and approve Freighter connection.

## What's Included

### ✅ Smart Contract Integration
- **File:** `frontend/src/hooks/useVaultContract.ts`
- **Function:** `getProposals()`
- **Features:**
  - Fetches proposal counter
  - Iterates through all proposals
  - Handles multiple storage key formats
  - Parses contract data to TypeScript objects

### ✅ State Management
- **File:** `frontend/src/hooks/useProposals.ts`
- **Features:**
  - Auto-fetch on mount
  - Loading/error states
  - Refetch capability
  - Status filtering

### ✅ UI Components
- **ProposalCard:** `frontend/src/components/ProposalCard.tsx`
- **StatusBadge:** `frontend/src/components/StatusBadge.tsx`
- **Proposals Page:** `frontend/src/app/dashboard/Proposals.tsx`

### ✅ Utility Functions
- **File:** `frontend/src/utils/formatters.ts`
- **Functions:**
  - `truncateAddress()` - Shorten addresses
  - `formatTokenAmount()` - Format XLM amounts
  - `formatLedger()` - Format ledger numbers

### ✅ Responsive Design
- Mobile: 1 column
- Tablet: 2 columns
- Desktop: 3 columns

### ✅ Features
- Status filtering (All, Pending, Approved, Executed, Rejected, Expired)
- Loading spinner
- Error handling with retry
- Empty state with CTA
- Refresh button
- Filter counts
- Hover/focus states

## File Structure

```
frontend/
├── src/
│   ├── app/
│   │   └── dashboard/
│   │       └── Proposals.tsx          ← Main page
│   ├── components/
│   │   ├── ProposalCard.tsx           ← Card component
│   │   └── StatusBadge.tsx            ← Status badge
│   ├── hooks/
│   │   ├── useVaultContract.ts        ← Contract integration
│   │   └── useProposals.ts            ← State management
│   └── utils/
│       └── formatters.ts              ← Utility functions
└── .env                                ← Configuration
```

## Testing Checklist

### Quick Test (2 minutes)
- [ ] Page loads without errors
- [ ] Loading spinner appears
- [ ] Proposals display (or empty state)
- [ ] Filter buttons work
- [ ] Refresh button works

### Full Test (10 minutes)
See `TESTING_CHECKLIST.md` for comprehensive testing.

## Common Issues & Solutions

### Issue: "Contract address not configured"
**Solution:** Set `VITE_CONTRACT_ADDRESS` in `.env`

### Issue: "Soroban server not available"
**Solution:** Check `VITE_SOROBAN_RPC_URL` in `.env`

### Issue: Empty proposal list
**Possible causes:**
1. No proposals in contract yet
2. Wrong contract address
3. Network mismatch (testnet vs mainnet)

**Debug:**
```javascript
// Open browser console
console.log(import.meta.env.VITE_CONTRACT_ADDRESS);
```

### Issue: Proposals not loading
**Solution:**
1. Check browser console for errors
2. Verify Freighter wallet connected
3. Check network connection
4. Try refresh button

## Data Flow

```
User Opens Page
      ↓
useProposals Hook Initializes
      ↓
useEffect Triggers fetchProposals()
      ↓
useVaultContract.getProposals() Called
      ↓
getCounter() - Fetch proposal count
      ↓
Loop: getProposalById(0...count)
      ↓
Parse Raw Contract Data
      ↓
Return Proposal[]
      ↓
Update State (setProposals)
      ↓
Render ProposalCard Components
      ↓
User Sees Proposals
```

## Key Code Snippets

### Fetch Proposals
```typescript
const { proposals, loading, error, refetch } = useProposals();
```

### Filter Proposals
```typescript
const filteredProposals = filterByStatus('Pending');
```

### Format Amount
```typescript
formatTokenAmount(10000000n) // "1 XLM"
```

### Truncate Address
```typescript
truncateAddress("GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
// "GXXXXX...XXXX"
```

## Next Steps

### For Testing
1. Deploy contract to testnet
2. Create test proposals
3. Run through `TESTING_CHECKLIST.md`
4. Test on mobile devices

### For Development
1. Read `IMPLEMENTATION_GUIDE.md` for deep dive
2. Review code comments
3. Check TypeScript types
4. Run ESLint: `npm run lint`

### For Deployment
1. Build: `npm run build`
2. Test: `npm run preview`
3. Deploy `dist/` folder
4. Update environment variables

## Resources

- **Implementation Guide:** `IMPLEMENTATION_GUIDE.md` (detailed explanation)
- **Testing Checklist:** `TESTING_CHECKLIST.md` (comprehensive testing)
- **Soroban Docs:** https://soroban.stellar.org/docs
- **Freighter Wallet:** https://www.freighter.app/

## Support

If you encounter issues:
1. Check browser console for errors
2. Review `.env` configuration
3. Verify contract deployment
4. Check network connectivity
5. Review `IMPLEMENTATION_GUIDE.md` troubleshooting section

## Summary

The proposal list feature is **production-ready** with:
- ✅ Real contract data
- ✅ Error handling
- ✅ Mobile responsive
- ✅ Accessible UI
- ✅ Performance optimized

Just configure your contract address and start testing!
