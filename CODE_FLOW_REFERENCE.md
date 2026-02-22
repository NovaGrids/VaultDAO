# Code Flow Reference - Proposal List Feature

## Complete Execution Flow

### 1. User Opens Proposals Page

```
Browser URL: /dashboard/proposals
         ↓
React Router matches route
         ↓
Renders: <Proposals /> component
```

### 2. Component Initialization

**File:** `frontend/src/app/dashboard/Proposals.tsx`

```typescript
const Proposals: React.FC = () => {
  // 1. Initialize hook
  const { proposals, loading, error, refetch, filterByStatus } = useProposals();
  
  // 2. Initialize filter state
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');
  
  // 3. Calculate counts (memoized)
  const counts = useMemo(() => {
    return {
      all: proposals.length,
      [ProposalStatus.Pending]: proposals.filter(p => p.status === ProposalStatus.Pending).length,
      // ... other statuses
    };
  }, [proposals]);
  
  // 4. Filter proposals (memoized)
  const filteredProposals = useMemo(() => {
    return filterByStatus(activeFilter);
  }, [activeFilter, filterByStatus]);
  
  // 5. Render UI
  return (/* JSX */);
};
```

### 3. useProposals Hook Execution

**File:** `frontend/src/hooks/useProposals.ts`

```typescript
export const useProposals = (): UseProposalsReturn => {
  // 1. Initialize state
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2. Get contract hook
  const { getProposals } = useVaultContract();

  // 3. Define fetch function (memoized)
  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Call contract
      const data = await getProposals();
      
      setProposals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  }, [getProposals]);

  // 4. Auto-fetch on mount
  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  // 5. Return interface
  return {
    proposals,
    loading,
    error,
    refetch: fetchProposals,
    filterByStatus: (status) => status === 'all' ? proposals : proposals.filter(p => p.status === status)
  };
};
```

### 4. useVaultContract Hook Execution

**File:** `frontend/src/hooks/useVaultContract.ts`

```typescript
export const useVaultContract = () => {
  // 1. Get Soroban connection
  const { server } = useSorobanReact();
  const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;

  // 2. Define getProposals function
  const getProposals = useCallback(async (): Promise<Proposal[]> => {
    // Step A: Validate prerequisites
    if (!contractAddress) {
      throw new Error('Contract address not configured');
    }
    if (!server) {
      throw new Error('Soroban server not available');
    }

    // Step B: Get proposal count
    const proposalCount = await getCounter();
    
    // Step C: Fetch all proposals
    const proposals: Proposal[] = [];
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

    // Step D: Return results
    return proposals;
  }, [contractAddress, getCounter, getProposalById, server]);

  return { getProposals };
};
```

### 5. Get Proposal Counter

```typescript
const getCounter = useCallback(async (): Promise<number> => {
  if (!server || !contractAddress) return 0;

  // Try multiple possible key names
  const counterKeys = ['NextProposalId', 'next_proposal_id', 'proposal_count'];
  
  for (const key of counterKeys) {
    try {
      // Query contract storage
      const result = await server.getContractData(contractAddress, key);
      
      // Extract value
      const val = unwrapVal(result);
      const parsed = Number(String(val));
      
      // Validate
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    } catch {
      // Try next key format
    }
  }
  
  return 0;
}, [contractAddress, server]);
```

**Network Call:**
```
GET https://soroban-testnet.stellar.org
Body: {
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getLedgerEntries",
  "params": {
    "keys": ["<contract_storage_key>"]
  }
}

Response: {
  "result": {
    "entries": [{
      "key": "...",
      "xdr": "...",
      "val": 5  // ← Proposal count
    }]
  }
}
```

### 6. Get Individual Proposal

```typescript
const getProposalById = useCallback(async (id: number): Promise<Proposal | null> => {
  if (!server || !contractAddress) return null;

  // Try multiple storage key formats
  const keysToTry = [
    `proposal_${id}`,           // Format 1: "proposal_0"
    `Proposal(${id})`,          // Format 2: "Proposal(0)"
    { Proposal: id },           // Format 3: { Proposal: 0 }
    id,                         // Format 4: 0
  ];

  for (const key of keysToTry) {
    try {
      // Query contract storage
      const result = await server.getContractData(contractAddress, key);
      
      // Parse and return
      return parseProposal(id, result);
    } catch {
      // Try next format
    }
  }

  return null;
}, [contractAddress, server]);
```

**Network Call:**
```
GET https://soroban-testnet.stellar.org
Body: {
  "jsonrpc": "2.0",
  "id": 2,
  "method": "getLedgerEntries",
  "params": {
    "keys": ["<proposal_storage_key>"]
  }
}

Response: {
  "result": {
    "entries": [{
      "key": "...",
      "xdr": "...",
      "val": {
        "id": 0,
        "proposer": "GXXX...",
        "recipient": "GYYY...",
        "amount": "10000000",
        "status": 0,
        "created_at": 1234567,
        "unlock_ledger": 0,
        "memo": "Payment"
      }
    }]
  }
}
```

### 7. Parse Proposal Data

```typescript
const parseProposal = (id: number, rawValue: unknown): Proposal => {
  // Step 1: Unwrap Soroban response
  const value = toObjectRecord(unwrapVal(rawValue));
  
  // Step 2: Extract fields (with fallbacks)
  const proposer = String(value.proposer ?? value.from ?? '');
  const recipient = String(value.recipient ?? value.to ?? '');
  const amount = toBigInt(value.amount ?? value.value);
  const status = normalizeStatus(value.status ?? value.state);
  const createdAt = Number(value.created_at ?? value.createdAt ?? 0);
  const unlockTime = value.unlock_ledger ?? value.unlockTime;
  const description = String(value.memo ?? value.description ?? '');
  
  // Step 3: Return typed object
  return {
    id,
    proposer,
    recipient,
    amount,
    status,
    description,
    createdAt,
    unlockTime: unlockTime ? Number(unlockTime) : undefined,
  };
};
```

**Example Transformation:**
```typescript
// Input (from contract):
{
  proposer: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  recipient: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  amount: "10000000",
  status: 0,
  created_at: 1234567,
  unlock_ledger: 0,
  memo: "Monthly payment"
}

// Output (TypeScript):
{
  id: 0,
  proposer: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  recipient: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  amount: 10000000n,  // BigInt
  status: 0,          // ProposalStatus.Pending
  description: "Monthly payment",
  createdAt: 1234567,
  unlockTime: undefined  // 0 means no timelock
}
```

### 8. State Update & Re-render

```typescript
// useProposals hook updates state
setProposals(data);  // data = Proposal[]
setLoading(false);

// React triggers re-render
         ↓
// Proposals component re-renders with new data
         ↓
// filteredProposals recalculated (useMemo)
         ↓
// counts recalculated (useMemo)
         ↓
// UI updates
```

### 9. Render Proposal Cards

```typescript
// In Proposals.tsx
{!loading && !error && filteredProposals.length > 0 ? (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
    {filteredProposals.map((proposal) => (
      <ProposalCard key={proposal.id} proposal={proposal} />
    ))}
  </div>
) : null}
```

### 10. ProposalCard Rendering

**File:** `frontend/src/components/ProposalCard.tsx`

```typescript
const ProposalCard: React.FC<ProposalCardProps> = ({ proposal }) => {
  return (
    <article className="...">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p>Proposal #{proposal.id}</p>
        <StatusBadge status={proposal.status} />
      </div>

      {/* Details */}
      <dl>
        <div>
          <dt>Proposer</dt>
          <dd>{truncateAddress(proposal.proposer)}</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{truncateAddress(proposal.recipient)}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatTokenAmount(proposal.amount)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatLedger(proposal.createdAt)}</dd>
        </div>
        {proposal.unlockTime ? (
          <div>
            <dt>Unlock</dt>
            <dd>{formatLedger(proposal.unlockTime)}</dd>
          </div>
        ) : null}
      </dl>

      {/* Description */}
      {proposal.description ? (
        <p>{proposal.description}</p>
      ) : null}
    </article>
  );
};
```

### 11. Formatting Functions

**File:** `frontend/src/utils/formatters.ts`

```typescript
// Address formatting
truncateAddress("GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
// Returns: "GXXXXX...XXXX"

// Amount formatting
formatTokenAmount(10000000n)
// Returns: "1 XLM"

formatTokenAmount(15000000n)
// Returns: "1.5 XLM"

formatTokenAmount(123456789n)
// Returns: "12.3456789 XLM"

// Ledger formatting
formatLedger(1234567)
// Returns: "#1,234,567"
```

### 12. StatusBadge Rendering

**File:** `frontend/src/components/StatusBadge.tsx`

```typescript
const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
};

// Status 0 (Pending) → Yellow badge with "Pending"
// Status 1 (Approved) → Cyan badge with "Approved"
// Status 2 (Executed) → Green badge with "Executed"
// Status 3 (Rejected) → Red badge with "Rejected"
// Status 4 (Expired) → Gray badge with "Expired"
```

## User Interaction Flows

### Flow A: Filter Proposals

```
User clicks "Pending" filter button
         ↓
setActiveFilter('Pending')
         ↓
React re-renders component
         ↓
filteredProposals recalculated (useMemo)
         ↓
Only pending proposals shown
         ↓
Filter button highlighted
         ↓
Count updated: "Pending (5)"
```

### Flow B: Refresh Proposals

```
User clicks "Refresh" button
         ↓
refetch() called
         ↓
fetchProposals() executed
         ↓
setLoading(true)
         ↓
Loading spinner shown
         ↓
getProposals() called
         ↓
Network requests to Soroban
         ↓
Data parsed and returned
         ↓
setProposals(newData)
         ↓
setLoading(false)
         ↓
UI updates with fresh data
```

### Flow C: Error Handling

```
Network request fails
         ↓
catch (err) block executed
         ↓
setError(err.message)
         ↓
setLoading(false)
         ↓
Error UI shown
         ↓
User clicks "Try again"
         ↓
refetch() called
         ↓
Process repeats
```

## State Transitions

```
Initial State:
  loading: true
  error: null
  proposals: []
         ↓
Fetching:
  loading: true
  error: null
  proposals: []
         ↓
Success:
  loading: false
  error: null
  proposals: [Proposal, Proposal, ...]
         ↓
Error:
  loading: false
  error: "Error message"
  proposals: []
         ↓
Retry:
  loading: true
  error: null
  proposals: []
```

## Performance Optimizations

### 1. Memoization
```typescript
// Only recalculate when dependencies change
const filteredProposals = useMemo(() => {
  return filterByStatus(activeFilter);
}, [activeFilter, filterByStatus]);

// Prevents:
// - Re-filtering on every render
// - Unnecessary array operations
// - Child component re-renders
```

### 2. Callback Optimization
```typescript
// Function reference stays stable
const fetchProposals = useCallback(async () => {
  // ...
}, [getProposals]);

// Prevents:
// - useEffect re-triggering
// - Infinite loops
// - Unnecessary re-renders
```

### 3. Conditional Rendering
```typescript
// Only render what's needed
{loading ? <LoadingState /> : null}
{!loading && error ? <ErrorState /> : null}
{!loading && !error && proposals.length === 0 ? <EmptyState /> : null}
{!loading && !error && proposals.length > 0 ? <ProposalGrid /> : null}

// Prevents:
// - Rendering hidden components
// - Unnecessary DOM operations
// - Layout thrashing
```

## Data Flow Summary

```
User Action
    ↓
React Component
    ↓
useProposals Hook
    ↓
useVaultContract Hook
    ↓
Soroban RPC Server
    ↓
Smart Contract Storage
    ↓
Raw Contract Data
    ↓
Parse & Transform
    ↓
TypeScript Objects
    ↓
React State Update
    ↓
Component Re-render
    ↓
UI Update
    ↓
User Sees Result
```

## Complete Call Stack

```
1. Proposals.tsx
   └─ useProposals()
      └─ useVaultContract()
         └─ getProposals()
            ├─ getCounter()
            │  └─ server.getContractData()
            │     └─ HTTP POST to Soroban RPC
            └─ getProposalById(0...n)
               └─ server.getContractData()
                  └─ HTTP POST to Soroban RPC
                     └─ parseProposal()
                        ├─ unwrapVal()
                        ├─ toObjectRecord()
                        ├─ toBigInt()
                        └─ normalizeStatus()
```

## Timing Diagram

```
Time  | Action
------|--------------------------------------------------
0ms   | User opens page
1ms   | Component mounts
2ms   | useProposals hook initializes
3ms   | useEffect triggers fetchProposals()
4ms   | setLoading(true)
5ms   | getProposals() called
10ms  | getCounter() - Network request
150ms | Counter received: 5
151ms | getProposalById(0) - Network request
200ms | Proposal 0 received
201ms | getProposalById(1) - Network request
250ms | Proposal 1 received
...   | (continue for all proposals)
800ms | All proposals fetched
801ms | setProposals(data)
802ms | setLoading(false)
803ms | Component re-renders
804ms | UI updates
805ms | User sees proposals
```

## Conclusion

This reference document shows the complete code flow from user action to UI update. Every function call, state change, and network request is documented for easy debugging and understanding.

**Key Takeaways:**
- Data flows from contract → hooks → components → UI
- State management is centralized in useProposals
- Error handling occurs at multiple levels
- Performance is optimized with memoization
- UI updates are conditional and efficient
