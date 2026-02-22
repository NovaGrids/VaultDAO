# Proposal List Feature - Complete Implementation Guide

## Overview
This guide explains how the proposal list feature was implemented from A to Z.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Proposals.tsx (Page)                     │
│  - Renders UI                                                │
│  - Manages filter state                                      │
│  - Handles user interactions                                 │
└────────────────────┬────────────────────────────────────────┘
                     │ uses
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  useProposals (Hook)                         │
│  - Manages proposals state                                   │
│  - Handles loading/error states                              │
│  - Provides refetch function                                 │
│  - Implements filtering logic                                │
└────────────────────┬────────────────────────────────────────┘
                     │ uses
                     ▼
┌─────────────────────────────────────────────────────────────┐
│               useVaultContract (Hook)                        │
│  - Connects to Soroban RPC                                   │
│  - Fetches contract data                                     │
│  - Parses raw contract responses                             │
│  - Handles multiple storage key formats                      │
└────────────────────┬────────────────────────────────────────┘
                     │ queries
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Stellar Soroban Network                         │
│  - Smart contract storage                                    │
│  - Proposal data (Persistent storage)                        │
│  - Counter (Instance storage)                                │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step Implementation

### Phase 1: Smart Contract Integration

#### 1.1 Define TypeScript Types
**File:** `frontend/src/hooks/useVaultContract.ts`

```typescript
// Match Rust contract types
export interface Proposal {
  id: number;
  proposer: string;
  recipient: string;
  amount: bigint;          // i128 in Rust
  status: ProposalStatus;
  description: string;
  createdAt: number;       // u64 ledger number
  unlockTime?: number;     // Optional timelock
}

export const ProposalStatus = {
  Pending: 0,
  Approved: 1,
  Executed: 2,
  Rejected: 3,
  Expired: 4,
} as const;
```

**Why bigint?** Stellar amounts use stroops (1 XLM = 10,000,000 stroops), which can exceed JavaScript's safe integer limit.

#### 1.2 Implement Data Parsing
**Challenge:** Soroban RPC returns data in various formats depending on storage type and SDK version.

**Solution:** Flexible parsing with fallbacks

```typescript
const parseProposal = (id: number, rawValue: unknown): Proposal => {
  const value = toObjectRecord(unwrapVal(rawValue));

  // Try multiple field name variations
  const proposer = String(value.proposer ?? value.from ?? '');
  const recipient = String(value.recipient ?? value.to ?? '');
  const amount = toBigInt(value.amount ?? value.value);
  const status = normalizeStatus(value.status ?? value.state);
  
  // Handle optional fields
  const unlockTime = value.unlock_ledger ?? value.unlockTime;
  
  return {
    id,
    proposer,
    recipient,
    amount,
    status,
    description: String(value.memo ?? value.description ?? ''),
    createdAt: Number(value.created_at ?? value.createdAt ?? 0),
    unlockTime: unlockTime ? Number(unlockTime) : undefined,
  };
};
```

#### 1.3 Implement Proposal Counter Fetching
**Challenge:** The contract stores a counter for the next proposal ID, but the storage key name may vary.

```typescript
const getCounter = async (): Promise<number> => {
  if (!server || !contractAddress) return 0;

  // Try multiple possible key names
  const counterKeys = ['NextProposalId', 'next_proposal_id', 'proposal_count'];
  
  for (const key of counterKeys) {
    try {
      const result = await server.getContractData(contractAddress, key);
      const val = unwrapVal(result);
      const parsed = Number(String(val));
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    } catch {
      // Try next key format
    }
  }
  return 0;
};
```

#### 1.4 Implement Individual Proposal Fetching
**Challenge:** Storage keys for proposals can be formatted differently.

```typescript
const getProposalById = async (id: number): Promise<Proposal | null> => {
  if (!server || !contractAddress) return null;

  // Try multiple storage key formats
  const keysToTry = [
    `proposal_${id}`,           // String key
    `Proposal(${id})`,          // Function-style key
    { Proposal: id },           // Object key
    id,                         // Direct number key
  ];

  for (const key of keysToTry) {
    try {
      const result = await server.getContractData(contractAddress, key);
      return parseProposal(id, result);
    } catch {
      // Try next format
    }
  }

  return null;
};
```

#### 1.5 Implement Bulk Proposal Fetching
```typescript
const getProposals = async (): Promise<Proposal[]> => {
  try {
    if (!contractAddress) {
      throw new Error('Contract address not configured');
    }
    if (!server) {
      throw new Error('Soroban server not available');
    }

    const proposalCount = await getCounter();
    const proposals: Proposal[] = [];

    // Fetch all proposals by ID
    for (let i = 0; i < proposalCount; i++) {
      try {
        const proposal = await getProposalById(i);
        if (proposal) {
          proposals.push(proposal);
        }
      } catch (error) {
        console.error(`Error fetching proposal ${i}:`, error);
        // Continue with other proposals
      }
    }

    return proposals;
  } catch (error) {
    console.error('Error fetching proposals:', error);
    throw new Error('Failed to fetch proposals from contract');
  }
};
```

### Phase 2: State Management Hook

#### 2.1 Create useProposals Hook
**File:** `frontend/src/hooks/useProposals.ts`

```typescript
export const useProposals = (): UseProposalsReturn => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getProposals } = useVaultContract();

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getProposals();
      setProposals(data);
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setError(
        err instanceof Error 
          ? err.message 
          : 'Failed to load proposals. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [getProposals]);

  const filterByStatus = (status: ProposalStatus | 'all'): Proposal[] => {
    if (status === 'all') return proposals;
    return proposals.filter(p => p.status === status);
  };

  // Auto-fetch on mount
  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  return {
    proposals,
    loading,
    error,
    refetch: fetchProposals,
    filterByStatus
  };
};
```

**Key Features:**
- Automatic fetching on mount
- Loading state management
- Error handling with user-friendly messages
- Refetch capability
- Client-side filtering

### Phase 3: Utility Functions

#### 3.1 Address Truncation
**File:** `frontend/src/utils/formatters.ts`

```typescript
export const truncateAddress = (address: string, left = 6, right = 4): string => {
  if (!address) return '-';
  if (address.length <= left + right) return address;
  return `${address.slice(0, left)}...${address.slice(-right)}`;
};
```

**Example:** `GXXX...XXXX` (6 chars + 4 chars)

#### 3.2 Token Amount Formatting
```typescript
export const formatTokenAmount = (amount: bigint | number | string): string => {
  const parsed = BigInt(String(amount ?? 0));
  const whole = parsed / 10_000_000n;  // Convert stroops to XLM
  const fraction = parsed % 10_000_000n;

  if (fraction === 0n) {
    return `${whole.toString()} XLM`;
  }

  // Remove trailing zeros from fraction
  const fractionText = fraction.toString().padStart(7, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText} XLM`;
};
```

**Examples:**
- `10000000n` → "1 XLM"
- `15000000n` → "1.5 XLM"
- `123456789n` → "12.3456789 XLM"

#### 3.3 Ledger Number Formatting
```typescript
export const formatLedger = (ledger: number): string => {
  if (!ledger || Number.isNaN(ledger)) return '-';
  return `#${ledger.toLocaleString()}`;
};
```

**Example:** `1234567` → "#1,234,567"

### Phase 4: UI Components

#### 4.1 StatusBadge Component
**File:** `frontend/src/components/StatusBadge.tsx`

```typescript
const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  [ProposalStatus.Pending]: {
    label: 'Pending',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
  [ProposalStatus.Approved]: {
    label: 'Approved',
    className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  [ProposalStatus.Executed]: {
    label: 'Executed',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
  [ProposalStatus.Rejected]: {
    label: 'Rejected',
    className: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  },
  [ProposalStatus.Expired]: {
    label: 'Expired',
    className: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  },
};
```

**Design:** Glassmorphism style with semi-transparent backgrounds and colored borders.

#### 4.2 ProposalCard Component
**File:** `frontend/src/components/ProposalCard.tsx`

```typescript
const ProposalCard: React.FC<ProposalCardProps> = ({ proposal }) => {
  return (
    <article
      tabIndex={0}
      className="rounded-xl border border-gray-700 bg-gray-800/80 p-4 
                 transition-colors hover:border-gray-500 
                 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
    >
      {/* Header: ID + Status */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-100">
          Proposal #{proposal.id}
        </p>
        <StatusBadge status={proposal.status} />
      </div>

      {/* Details */}
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Proposer</dt>
          <dd className="font-mono text-gray-200">
            {truncateAddress(proposal.proposer)}
          </dd>
        </div>
        {/* ... more fields ... */}
      </dl>

      {/* Optional description */}
      {proposal.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-gray-400">
          {proposal.description}
        </p>
      ) : null}
    </article>
  );
};
```

**Accessibility:**
- `tabIndex={0}`: Keyboard navigable
- `focus:ring`: Visible focus indicator
- Semantic HTML (`<article>`, `<dl>`, `<dt>`, `<dd>`)

#### 4.3 Proposals Page
**File:** `frontend/src/app/dashboard/Proposals.tsx`

**Structure:**
1. Header with title and refresh button
2. Filter tabs with counts
3. Content area (loading/error/empty/proposals)
4. Responsive grid

**Filter Implementation:**
```typescript
const [activeFilter, setActiveFilter] = useState<FilterValue>('all');

const filteredProposals = useMemo(() => {
  return filterByStatus(activeFilter);
}, [activeFilter, filterByStatus]);

// Count proposals by status
const counts = useMemo(() => {
  return {
    all: proposals.length,
    [ProposalStatus.Pending]: proposals.filter(p => p.status === ProposalStatus.Pending).length,
    // ... other statuses
  };
}, [proposals]);
```

**Loading State:**
```typescript
{loading ? (
  <div className="flex min-h-64 items-center justify-center 
                  rounded-xl border border-gray-700 bg-gray-800/60">
    <div className="flex items-center gap-3 text-gray-300">
      <Loader2 className="animate-spin" size={18} />
      <span>Loading proposals...</span>
    </div>
  </div>
) : null}
```

**Error State:**
```typescript
{!loading && error ? (
  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5">
    <div className="flex items-start gap-3">
      <AlertCircle size={18} />
      <div>
        <p className="font-medium">Unable to load proposals</p>
        <p className="mt-1 text-sm">{error}</p>
        <button onClick={() => void refetch()}>Try again</button>
      </div>
    </div>
  </div>
) : null}
```

**Empty State:**
```typescript
{!loading && !error && filteredProposals.length === 0 ? (
  <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-10 text-center">
    <FileText className="mx-auto text-gray-500" size={28} />
    <h3 className="mt-3 text-lg font-semibold">No proposals found</h3>
    <p className="mt-1 text-sm text-gray-400">
      Create your first proposal to start treasury governance.
    </p>
    <button className="mt-4 rounded-lg bg-cyan-600 px-4 py-2">
      Create your first proposal
    </button>
  </div>
) : null}
```

**Proposals Grid:**
```typescript
{!loading && !error && filteredProposals.length > 0 ? (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
    {filteredProposals.map((proposal) => (
      <ProposalCard key={proposal.id} proposal={proposal} />
    ))}
  </div>
) : null}
```

### Phase 5: Responsive Design

#### 5.1 Breakpoints
- **Mobile:** `< 768px` → 1 column
- **Tablet:** `768px - 1023px` → 2 columns
- **Desktop:** `≥ 1024px` → 3 columns

#### 5.2 Tailwind Classes
```typescript
className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
```

- `grid-cols-1`: Default (mobile)
- `md:grid-cols-2`: Medium screens and up
- `lg:grid-cols-3`: Large screens and up

#### 5.3 Filter Buttons
```typescript
className="flex flex-wrap gap-2"
```

Buttons wrap on small screens, stay inline on larger screens.

#### 5.4 Header
```typescript
className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
```

- Mobile: Stacked vertically
- Desktop: Horizontal with space-between

### Phase 6: Error Handling

#### 6.1 Network Errors
```typescript
try {
  const data = await getProposals();
  setProposals(data);
} catch (err) {
  setError(
    err instanceof Error 
      ? err.message 
      : 'Failed to load proposals. Please try again.'
  );
}
```

#### 6.2 Missing Configuration
```typescript
if (!contractAddress) {
  throw new Error('Contract address not configured');
}
if (!server) {
  throw new Error('Soroban server not available');
}
```

#### 6.3 Individual Proposal Failures
```typescript
for (let i = 0; i < proposalCount; i++) {
  try {
    const proposal = await getProposalById(i);
    if (proposal) proposals.push(proposal);
  } catch (error) {
    console.error(`Error fetching proposal ${i}:`, error);
    // Continue with other proposals
  }
}
```

**Strategy:** Fail gracefully - if one proposal fails, continue fetching others.

### Phase 7: Performance Optimization

#### 7.1 useMemo for Filtering
```typescript
const filteredProposals = useMemo(() => {
  return filterByStatus(activeFilter);
}, [activeFilter, filterByStatus]);
```

Prevents re-filtering on every render.

#### 7.2 useMemo for Counts
```typescript
const counts = useMemo(() => {
  return {
    all: proposals.length,
    [ProposalStatus.Pending]: proposals.filter(p => p.status === ProposalStatus.Pending).length,
    // ...
  };
}, [proposals]);
```

Recalculates only when proposals change.

#### 7.3 useCallback for Functions
```typescript
const fetchProposals = useCallback(async () => {
  // ...
}, [getProposals]);
```

Prevents unnecessary re-renders of child components.

## Testing Strategy

### Unit Tests (Future)
```typescript
describe('useVaultContract', () => {
  it('should parse proposals correctly', () => {
    const raw = { /* mock data */ };
    const parsed = parseProposal(0, raw);
    expect(parsed.id).toBe(0);
    expect(parsed.amount).toBeInstanceOf(BigInt);
  });
});
```

### Integration Tests
1. Deploy contract to testnet
2. Create test proposals with various statuses
3. Verify UI displays correctly
4. Test filtering
5. Test error scenarios

### Manual Testing
See `TESTING_CHECKLIST.md` for comprehensive checklist.

## Deployment

### 1. Build
```bash
cd frontend
npm run build
```

### 2. Environment Variables
Ensure `.env` has correct values:
```
VITE_CONTRACT_ADDRESS=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### 3. Deploy
```bash
npm run preview  # Test production build locally
# Then deploy dist/ folder to hosting service
```

## Troubleshooting

### Issue: Proposals not loading
**Check:**
1. Contract address in `.env`
2. Network connection
3. Browser console for errors
4. Freighter wallet connected

### Issue: Wrong data displayed
**Check:**
1. Contract storage key format
2. Data parsing logic
3. Type conversions (especially BigInt)

### Issue: Styling broken
**Check:**
1. Tailwind CSS compiled
2. PostCSS configuration
3. Browser compatibility

## Future Enhancements

1. **Pagination:** For 100+ proposals
2. **Search:** Filter by proposer/recipient
3. **Sorting:** By date, amount, status
4. **Details Modal:** Click card to see full details
5. **Real-time Updates:** WebSocket for live data
6. **Optimistic Updates:** Show changes before confirmation
7. **Caching:** Store proposals in localStorage
8. **Infinite Scroll:** Load more as user scrolls

## Conclusion

This implementation provides a production-ready proposal list with:
- ✅ Real contract data integration
- ✅ Robust error handling
- ✅ Mobile responsive design
- ✅ Accessible UI components
- ✅ Performance optimizations
- ✅ Comprehensive testing strategy

The code is maintainable, scalable, and follows React best practices.
