# Design Document: Reputation System

## Overview

The reputation system is a comprehensive tracking and incentive mechanism integrated into the VaultDAO smart contract. It monitors user behavior across the proposal lifecycle—creation, approval, execution, and rejection—and maintains a numerical reputation score (0-1000) for each participant. This score influences proposal limits and priority, creating a feedback loop that rewards reliable contributors and constrains potentially problematic actors.

The system builds upon the existing Reputation struct and storage functions, enhancing them with:
- Reputation-based proposal limits
- Automatic priority assignment based on reputation
- Enhanced decay mechanisms
- Reputation history tracking
- Success rate calculations
- Admin controls for exceptional cases

The design integrates seamlessly with existing proposal lifecycle hooks (`update_reputation_on_propose`, `update_reputation_on_approval`, `update_reputation_on_execution`, `update_reputation_on_rejection`) while adding new functionality for limits, priority, and history tracking.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      VaultDAO Contract                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Proposal Lifecycle Functions               │    │
│  │  - propose_transfer()                              │    │
│  │  - approve_proposal()                              │    │
│  │  - execute_proposal()                              │    │
│  │  - reject_proposal()                               │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                            │
│                 │ calls                                      │
│                 ▼                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │      Reputation Update Functions (existing)        │    │
│  │  - update_reputation_on_propose()                  │    │
│  │  - update_reputation_on_approval()                 │    │
│  │  - update_reputation_on_execution()                │    │
│  │  - update_reputation_on_rejection()                │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                            │
│                 │ uses                                       │
│                 ▼                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Reputation Core Functions (NEW)            │    │
│  │  - check_proposal_limit()                          │    │
│  │  - get_proposal_limit()                            │    │
│  │  - calculate_success_rate()                        │    │
│  │  - determine_priority_from_reputation()            │    │
│  │  - add_reputation_history_entry()                  │    │
│  │  - reset_reputation() [admin only]                 │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                            │
│                 │ reads/writes                               │
│                 ▼                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Storage Layer (storage.rs)                 │    │
│  │  - get_reputation()                                │    │
│  │  - set_reputation()                                │    │
│  │  - apply_reputation_decay()                        │    │
│  │  - get_reputation_history() [NEW]                  │    │
│  │  - set_reputation_history() [NEW]                  │    │
│  │  - get_active_proposal_count() [NEW]               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Proposal Creation**: User creates proposal → `check_proposal_limit()` validates against reputation-based limit → `determine_priority_from_reputation()` sets initial priority → `update_reputation_on_propose()` increments counter
2. **Proposal Approval**: Signer approves → `update_reputation_on_approval()` awards points and increments counter
3. **Proposal Execution**: Executor runs proposal → `update_reputation_on_execution()` rewards proposer and all approvers → history entries added
4. **Proposal Rejection**: Proposal rejected → `update_reputation_on_rejection()` penalizes proposer → history entry added
5. **Reputation Query**: Any query → `apply_reputation_decay()` runs first → current data returned

## Components and Interfaces

### Enhanced Reputation Type

The existing `Reputation` struct in `types.rs` already contains the necessary fields:

```rust
pub struct Reputation {
    pub score: u32,                    // 0-1000, starts at 500
    pub proposals_executed: u32,
    pub proposals_rejected: u32,
    pub proposals_created: u32,
    pub approvals_given: u32,
    pub last_decay_ledger: u64,
}
```

### New Type: ReputationHistoryEntry

Add to `types.rs`:

```rust
#[contracttype]
pub struct ReputationHistoryEntry {
    pub ledger: u64,           // When the change occurred
    pub old_score: u32,        // Score before change
    pub new_score: u32,        // Score after change
    pub reason: Symbol,        // "proposed", "approved", "executed", "rejected", "decay", "reset"
    pub proposal_id: u64,      // Associated proposal (0 if not applicable)
}
```

### Storage Functions (storage.rs)

**Existing functions to keep:**
- `get_reputation(env: &Env, addr: &Address) -> Reputation`
- `set_reputation(env: &Env, addr: &Address, rep: &Reputation)`
- `apply_reputation_decay(env: &Env, rep: &mut Reputation)`

**New functions to add:**

```rust
// Reputation history management
pub fn get_reputation_history(env: &Env, addr: &Address) -> Vec<ReputationHistoryEntry>

pub fn add_reputation_history_entry(
    env: &Env,
    addr: &Address,
    old_score: u32,
    new_score: u32,
    reason: Symbol,
    proposal_id: u64
)

// Active proposal tracking
pub fn get_active_proposal_count(env: &Env, addr: &Address) -> u32

pub fn increment_active_proposals(env: &Env, addr: &Address)

pub fn decrement_active_proposals(env: &Env, addr: &Address)
```

### Core Reputation Functions (lib.rs)

**New public functions:**

```rust
/// Get the proposal limit for a user based on their reputation
pub fn get_proposal_limit(env: Env, addr: Address) -> u32

/// Calculate success rate for a user (returns basis points: 0-10000)
pub fn calculate_success_rate(env: Env, addr: Address) -> u32

/// Get reputation history for a user
pub fn get_reputation_history(env: Env, addr: Address) -> Vec<ReputationHistoryEntry>

/// Admin function to reset a user's reputation
pub fn reset_reputation(env: Env, admin: Address, target: Address) -> Result<(), VaultError>
```

**New internal functions:**

```rust
/// Check if user can create another proposal based on their limit
fn check_proposal_limit(env: &Env, proposer: &Address) -> Result<(), VaultError>

/// Determine proposal priority based on proposer's reputation
fn determine_priority_from_reputation(env: &Env, proposer: &Address) -> Priority

/// Calculate proposal limit based on reputation score
fn calculate_proposal_limit(score: u32) -> u32
```

### Integration Points

**Modify `propose_transfer()` function:**
- Add call to `check_proposal_limit()` before creating proposal
- Add call to `determine_priority_from_reputation()` to set initial priority
- Add call to `increment_active_proposals()` after proposal creation

**Modify `execute_proposal()` function:**
- Add call to `decrement_active_proposals()` after execution
- Enhance `update_reputation_on_execution()` to add history entries

**Modify `reject_proposal()` function:**
- Add call to `decrement_active_proposals()` after rejection
- Enhance `update_reputation_on_rejection()` to add history entry

**Modify `cancel_proposal()` function:**
- Add call to `decrement_active_proposals()` after cancellation
- No reputation penalty for self-cancellation

## Data Models

### Storage Keys

Add to `DataKey` enum in `storage.rs`:

```rust
pub enum DataKey {
    // ... existing keys ...
    ReputationHistory(Address),      // Vec<ReputationHistoryEntry>
    ActiveProposalCount(Address),    // u32
}
```

### Reputation Score Ranges and Limits

| Score Range | Proposal Limit | Auto Priority | Description |
|-------------|----------------|---------------|-------------|
| 0-299       | 1              | Low           | Poor track record, highly restricted |
| 300-599     | 3              | Medium        | Neutral to slightly positive |
| 600-799     | 5              | Medium        | Good track record |
| 800-1000    | 10             | High          | Excellent track record |

### Reputation Score Adjustments

| Event | Proposer Change | Approver Change | Notes |
|-------|----------------|-----------------|-------|
| Proposal Created | +0 | N/A | Counter incremented only |
| Proposal Approved | N/A | +2 | Small reward for participation |
| Proposal Executed | +10 | +5 | Reward for successful completion |
| Proposal Rejected | -20 | +0 | Penalty for failed proposal |
| Proposal Cancelled | +0 | N/A | No penalty for self-cancellation |
| 30 Days Inactive | Decay 5% toward 500 | Decay 5% toward 500 | Ensures recent activity matters |

### Reputation History

- Maximum 50 entries per user
- Stored as a circular buffer (oldest removed when full)
- Each entry contains: ledger, old_score, new_score, reason, proposal_id
- Reasons: "proposed", "approved", "executed", "rejected", "decay", "reset"

## Data Models

### Constants

Add to `lib.rs`:

```rust
// Reputation score boundaries
const REP_SCORE_MIN: u32 = 0;
const REP_SCORE_MAX: u32 = 1000;
const REP_SCORE_NEUTRAL: u32 = 500;

// Proposal limits by reputation tier
const LIMIT_LOW_REP: u32 = 1;      // Score < 300
const LIMIT_MID_REP: u32 = 3;      // Score 300-599
const LIMIT_HIGH_REP: u32 = 5;     // Score 600-799
const LIMIT_ELITE_REP: u32 = 10;   // Score >= 800

// Reputation thresholds for limits
const THRESHOLD_LOW: u32 = 300;
const THRESHOLD_MID: u32 = 600;
const THRESHOLD_HIGH: u32 = 800;

// Reputation thresholds for priority
const PRIORITY_HIGH_THRESHOLD: u32 = 700;
const PRIORITY_LOW_THRESHOLD: u32 = 400;

// History management
const MAX_HISTORY_ENTRIES: u32 = 50;

// Decay configuration (already exists but documenting)
const DECAY_INTERVAL: u64 = 17_280 * 30;  // ~30 days in ledgers
const DECAY_RATE_BPS: u32 = 500;          // 5% = 500 basis points
const DECAY_MIN_SCORE: u32 = 100;         // Never decay below this
```


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property Reflection

After analyzing all acceptance criteria, I identified several areas where properties can be consolidated:

1. **Counter tracking properties (1.3-1.6, 2.1, 2.3, 2.5, 2.6)**: These all test that counters accurately reflect actions. Can be consolidated into comprehensive counter invariant properties.

2. **Score bounds properties (1.1, 2.8, 2.9)**: These all test that scores stay within 0-1000 range. Can be consolidated into a single bounds invariant.

3. **Proposal limit properties (4.1-4.4)**: These test the same calculation function with different inputs. Can be consolidated into a single property that tests the limit calculation across all score ranges.

4. **Priority assignment properties (5.1-5.3)**: Similar to limits, these test the same function with different inputs. Can be consolidated.

5. **API existence checks (3.3, 7.4, 8.1-8.4)**: These are not properties but examples that verify methods exist and return expected types.

### Core Properties

**Property 1: Reputation score bounds invariant**

*For any* user and any sequence of reputation-affecting actions (propose, approve, execute, reject, decay), the user's Reputation_Score SHALL always remain within the range [0, 1000] inclusive.

**Validates: Requirements 1.1, 2.8, 2.9**

---

**Property 2: Proposal creation counter accuracy**

*For any* user, the proposals_created counter SHALL equal the total number of proposals created by that user.

**Validates: Requirements 1.3, 2.1**

---

**Property 3: Proposal execution counter accuracy**

*For any* user, the proposals_executed counter SHALL equal the total number of proposals by that user that reached executed status.

**Validates: Requirements 1.4, 2.3**

---

**Property 4: Proposal rejection counter accuracy**

*For any* user, the proposals_rejected counter SHALL equal the total number of proposals by that user that reached rejected status.

**Validates: Requirements 1.5, 2.5**

---

**Property 5: Approval counter accuracy**

*For any* signer, the approvals_given counter SHALL equal the total number of proposals that signer has approved.

**Validates: Requirements 1.6, 2.6**

---

**Property 6: Execution increases proposer score**

*For any* proposal that is successfully executed, the proposer's Reputation_Score SHALL increase (unless already at maximum 1000).

**Validates: Requirements 2.2**

---

**Property 7: Rejection decreases proposer score**

*For any* proposal that is rejected, the proposer's Reputation_Score SHALL decrease (unless already at minimum 0).

**Validates: Requirements 2.4**

---

**Property 8: Approval increases approver score on execution**

*For any* proposal that is successfully executed, each approver's Reputation_Score SHALL increase (unless already at maximum 1000).

**Validates: Requirements 2.7**

---

**Property 9: Success rate calculation correctness**

*For any* user with proposals_created > 0, the calculated Success_Rate SHALL equal (proposals_executed / proposals_created) × 100, rounded to two decimal places.

**Validates: Requirements 3.1, 3.4**

---

**Property 10: Proposal limit calculation correctness**

*For any* Reputation_Score value, the calculated Proposal_Limit SHALL be:
- 1 if score < 300
- 3 if 300 ≤ score < 600
- 5 if 600 ≤ score < 800
- 10 if score ≥ 800

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

---

**Property 11: Proposal limit enforcement**

*For any* user attempting to create a proposal, if their active proposal count equals or exceeds their Proposal_Limit, the proposal creation SHALL fail with an error.

**Validates: Requirements 4.5, 4.6**

---

**Property 12: Priority assignment from reputation**

*For any* newly created proposal, the initial priority SHALL be:
- High if proposer's Reputation_Score > 700
- Medium if 400 ≤ proposer's Reputation_Score ≤ 700
- Low if proposer's Reputation_Score < 400

**Validates: Requirements 5.1, 5.2, 5.3**

---

**Property 13: Manual priority override**

*For any* proposal with reputation-based priority, manually setting a different priority SHALL succeed and the new priority SHALL persist.

**Validates: Requirements 5.4**

---

**Property 14: Decay application on access**

*For any* user whose reputation is accessed after 30+ days of inactivity, decay SHALL be applied before returning the reputation data.

**Validates: Requirements 6.1, 8.5**

---

**Property 15: Decay calculation correctness**

*For any* Reputation_Score and elapsed time in 30-day periods, the decayed score SHALL move 5% closer to 500 per period, never going below 100.

**Validates: Requirements 6.2, 6.4**

---

**Property 16: Decay timestamp update**

*For any* reputation where decay is applied, the last_decay_ledger SHALL be updated to the current ledger sequence.

**Validates: Requirements 6.3**

---

**Property 17: Decay before update ordering**

*For any* reputation-affecting action, pending decay SHALL be applied before the action's score change is applied.

**Validates: Requirements 6.6**

---

**Property 18: History entry creation**

*For any* reputation score change, a history entry SHALL be created containing the ledger, old_score, new_score, reason, and proposal_id.

**Validates: Requirements 7.1, 7.2**

---

**Property 19: History size limit**

*For any* user's reputation history, the number of entries SHALL never exceed 50.

**Validates: Requirements 7.3**

---

**Property 20: History circular buffer behavior**

*For any* user with 50 history entries, adding a new entry SHALL remove the oldest entry and add the new one, maintaining exactly 50 entries.

**Validates: Requirements 7.5**

---

**Property 21: Admin reset completeness**

*For any* user whose reputation is reset by an admin, the resulting state SHALL have score=500, proposals_created=0, proposals_executed=0, proposals_rejected=0, approvals_given=0, and a history entry with reason="reset".

**Validates: Requirements 9.1, 9.2**

---

**Property 22: Admin-only reset authorization**

*For any* non-admin user attempting to reset reputation, the operation SHALL fail with an authorization error.

**Validates: Requirements 9.3**

---

**Property 23: Automatic reputation update on propose**

*For any* proposal creation, the proposer's proposals_created counter SHALL automatically increment.

**Validates: Requirements 10.1**

---

**Property 24: Automatic reputation update on approve**

*For any* proposal approval, the approver's approvals_given counter SHALL automatically increment and their score SHALL increase.

**Validates: Requirements 10.2**

---

**Property 25: Automatic reputation update on execute**

*For any* proposal execution, both the proposer's and all approvers' scores SHALL automatically increase and their respective counters SHALL update.

**Validates: Requirements 10.3**

---

**Property 26: Automatic reputation update on reject**

*For any* proposal rejection, the proposer's score SHALL automatically decrease and their proposals_rejected counter SHALL increment.

**Validates: Requirements 10.4**

---

**Property 27: No reputation change on cancellation**

*For any* proposal cancelled by its proposer, the proposer's Reputation_Score SHALL remain unchanged (though active proposal count decreases).

**Validates: Requirements 10.5**

---

### Edge Cases

The following edge cases are important to handle and will be covered by property test generators:

1. **Zero proposals edge case (3.2)**: When proposals_created = 0, Success_Rate returns 0 (division by zero handling)
2. **Decay minimum bound (6.5)**: Decay never reduces score below 100
3. **Score at boundaries**: Test behavior when score is exactly 0, 100, 300, 400, 500, 600, 700, 800, 1000
4. **History at capacity**: Test adding entries when history has exactly 50 entries
5. **Multiple decay periods**: Test decay after 60, 90, 120+ days of inactivity

## Error Handling

### Error Cases

1. **Proposal Limit Exceeded**: Return `VaultError::ProposalLimitExceeded` when user tries to create proposal beyond their limit
2. **Unauthorized Reset**: Return `VaultError::Unauthorized` when non-admin tries to reset reputation
3. **Invalid Address**: Return `VaultError::InvalidAddress` when querying reputation for invalid address
4. **Storage Errors**: Propagate storage errors when reading/writing reputation data

### Error Recovery

- All reputation operations are atomic - either fully succeed or fully fail
- Failed operations do not partially update reputation state
- Decay is idempotent - applying decay multiple times in same ledger has no additional effect
- History overflow is handled gracefully by removing oldest entries

### Validation

- Score adjustments always check bounds before applying
- Counter increments use saturating arithmetic to prevent overflow
- Decay calculations use saturating arithmetic to prevent underflow
- Active proposal count is validated against actual proposal states periodically

## Testing Strategy

### Dual Testing Approach

The reputation system requires both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs
- Both are complementary and necessary

### Unit Testing Focus

Unit tests should cover:
- Specific initialization values (score starts at 500)
- Edge cases (zero proposals, score at boundaries, history at capacity)
- Error conditions (unauthorized reset, limit exceeded)
- Integration points (reputation updates during proposal lifecycle)
- Event emission verification

### Property-Based Testing

We will use **proptest** (Rust's property-based testing library) for this feature.

**Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with: **Feature: reputation-system, Property N: [property text]**

**Generator Strategy**:
- Generate random users with varying reputation scores (0-1000)
- Generate random proposal sequences (create, approve, execute, reject, cancel)
- Generate random time advances for decay testing
- Generate edge case values (0, 100, 300, 400, 500, 600, 700, 800, 1000)

**Property Test Coverage**:
- Each of the 27 correctness properties will have a corresponding property-based test
- Tests will generate random inputs and verify the property holds
- Edge cases will be included in the generator distributions

### Integration Testing

- Test reputation updates across full proposal lifecycle
- Test decay application during various operations
- Test history tracking across multiple actions
- Test proposal limit enforcement with concurrent proposals
- Test priority assignment and manual override interactions

### Test Data

- Use realistic reputation scores (not just boundary values)
- Test with various proposal counts (0, 1, 10, 100, 1000+)
- Test with various time periods (0 days, 30 days, 90 days, 1 year)
- Test with multiple users interacting simultaneously
