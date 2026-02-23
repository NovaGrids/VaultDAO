# Transaction Simulation Usage Guide

This guide explains how to integrate transaction simulation into your components.

## Overview

The transaction simulation feature allows users to preview transaction results, estimate fees, and detect errors before submitting transactions to the blockchain.

## Components

### 1. TransactionSimulator

The main simulation UI component that handles the simulation flow.

```tsx
import TransactionSimulator from '../components/TransactionSimulator';
import type { SimulationResult } from '../utils/simulation';

<TransactionSimulator
  onSimulate={handleSimulate}
  onProceed={handleProceed}
  onCancel={handleCancel}
  actionLabel="Submit Transaction"
  disabled={false}
/>
```

**Props:**
- `onSimulate`: Async function that returns a `SimulationResult`
- `onProceed`: Callback when user confirms after successful simulation
- `onCancel`: Callback when user cancels
- `actionLabel`: Label for the proceed button (default: "Submit")
- `disabled`: Disable the simulator

### 2. ProposalActionWithSimulation

Pre-built component for proposal actions (approve, execute, reject).

```tsx
import ProposalActionWithSimulation from '../components/ProposalActionWithSimulation';

<ProposalActionWithSimulation
  actionType="approve"
  proposalId="123"
  onSimulate={simulateApprove}
  onConfirm={handleApprove}
  onCancel={handleCancel}
  loading={isLoading}
/>
```

## Using Simulation Hooks

### Available Simulation Functions

From `useVaultContract`:

```tsx
const {
  simulateProposeTransfer,
  simulateApproveProposal,
  simulateExecuteProposal,
  simulateRejectProposal,
} = useVaultContract();
```

### Example: Propose Transfer

```tsx
import { useState } from 'react';
import { useVaultContract } from '../hooks/useVaultContract';
import TransactionSimulator from '../components/TransactionSimulator';

function MyComponent() {
  const { simulateProposeTransfer, proposeTransfer } = useVaultContract();
  const [showSimulation, setShowSimulation] = useState(false);
  const [formData, setFormData] = useState({
    recipient: '',
    token: '',
    amount: '',
    memo: '',
  });

  const handleSimulate = async () => {
    return await simulateProposeTransfer(
      formData.recipient,
      formData.token,
      formData.amount,
      formData.memo
    );
  };

  const handleProceed = async () => {
    setShowSimulation(false);
    await proposeTransfer(
      formData.recipient,
      formData.token,
      formData.amount,
      formData.memo
    );
  };

  return (
    <div>
      {!showSimulation ? (
        <form onSubmit={(e) => { e.preventDefault(); setShowSimulation(true); }}>
          {/* Form fields */}
          <button type="submit">Continue to Simulation</button>
        </form>
      ) : (
        <TransactionSimulator
          onSimulate={handleSimulate}
          onProceed={handleProceed}
          onCancel={() => setShowSimulation(false)}
          actionLabel="Submit Proposal"
        />
      )}
    </div>
  );
}
```

### Example: Approve Proposal

```tsx
const { simulateApproveProposal, approveProposal } = useVaultContract();

const handleSimulate = async () => {
  return await simulateApproveProposal(proposalId);
};

const handleApprove = async () => {
  await approveProposal(proposalId);
};

<ProposalActionWithSimulation
  actionType="approve"
  proposalId={proposalId}
  onSimulate={handleSimulate}
  onConfirm={handleApprove}
  onCancel={() => setShowModal(false)}
/>
```

## Simulation Result Structure

```typescript
interface SimulationResult {
  success: boolean;
  fee: string;              // Total fee in stroops
  feeXLM: string;          // Total fee in XLM
  resourceFee: string;     // Resource fee in XLM
  error?: string;          // Error message if failed
  errorCode?: string;      // Error code for programmatic handling
  stateChanges?: StateChange[];  // Expected state changes
  timestamp: number;       // Simulation timestamp
}

interface StateChange {
  type: 'balance' | 'proposal' | 'approval' | 'config' | 'role';
  description: string;
  before?: string;
  after?: string;
}
```

## Caching

Simulations are automatically cached for 30 seconds to avoid redundant RPC calls. The cache key is generated from:
- Function name
- Arguments
- User address

## Error Handling

The simulation utility provides user-friendly error messages:

```typescript
import { parseSimulationError } from '../utils/simulation';

try {
  const result = await simulateProposeTransfer(...);
} catch (error) {
  const { message, code, suggestion } = parseSimulationError(error);
  // Display to user
}
```

### Common Error Codes

- `INSUFFICIENT_BALANCE`: Vault doesn't have enough funds
- `UNAUTHORIZED`: User lacks required permissions
- `THRESHOLD_NOT_MET`: Not enough approvals
- `TIMELOCK_ACTIVE`: Timelock period not expired
- `PROPOSAL_EXPIRED`: Proposal has expired
- `NOT_WHITELISTED`: Recipient not on whitelist
- `BLACKLISTED`: Recipient is blacklisted

### Warnings vs Errors

Some errors are classified as warnings and allow users to proceed:

```typescript
import { isWarning } from '../utils/simulation';

if (result.errorCode && isWarning(result.errorCode)) {
  // Show "Proceed Anyway" button
}
```

Warning codes:
- `TIMELOCK_ACTIVE`
- `THRESHOLD_NOT_MET`

## Mobile Responsiveness

All simulation components are mobile-responsive:
- Collapsible details sections
- Touch-friendly buttons (min-height: 44px)
- Scrollable content areas
- Responsive layouts (flex-col on mobile, flex-row on desktop)

## Best Practices

1. **Always simulate before submitting**: Show simulation before final submission
2. **Cache awareness**: Simulations are cached for 30s - inform users if data might be stale
3. **Error handling**: Always handle simulation errors gracefully
4. **Loading states**: Show loading indicators during simulation
5. **Clear messaging**: Explain what the simulation shows
6. **Mobile testing**: Test on various screen sizes

## Integration Checklist

- [ ] Import simulation hooks from `useVaultContract`
- [ ] Create simulation handler function
- [ ] Add TransactionSimulator component
- [ ] Implement two-step flow (form -> simulation -> submit)
- [ ] Handle simulation errors
- [ ] Test on mobile devices
- [ ] Add loading states
- [ ] Implement cancel functionality
