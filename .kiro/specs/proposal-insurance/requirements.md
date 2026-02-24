# Requirements Document: Proposal Insurance System

## Introduction

The Proposal Insurance System introduces a bond-based mechanism to deter malicious proposals and ensure proposers have financial accountability ("skin in the game"). Proposers must post bonds that scale with proposal risk and amount. Bonds are slashed for rejected proposals and refunded for executed proposals. This system creates economic incentives for good governance while maintaining an insurance pool to protect the vault from malicious activity.

## Glossary

- **Bond**: A refundable deposit posted by a proposer when creating a proposal, held in escrow until proposal resolution
- **Insurance_Pool**: An on-chain account that holds slashed bonds and manages insurance fund distribution
- **Slashing**: The act of confiscating part or all of a proposer's bond when their proposal is rejected
- **Basis_Points**: A unit of measurement equal to 1/100th of a percent (e.g., 100 bps = 1%)
- **Proposer**: The address that creates a transfer proposal and must post the required bond
- **Vault**: The main smart contract managing multisig treasury operations
- **Config**: The on-chain configuration structure containing vault parameters
- **Proposal**: A transfer request that requires approval from signers before execution
- **InsuranceConfig**: Configuration structure defining insurance system parameters

## Requirements

### Requirement 1: Insurance Configuration

**User Story:** As a vault administrator, I want to configure insurance requirements, so that I can customize bond amounts and slashing rules based on vault risk tolerance.

#### Acceptance Criteria

1. THE Config SHALL include an InsuranceConfig field containing insurance system parameters
2. WHEN insurance is enabled, THE Vault SHALL enforce bond requirements on all proposals above the minimum amount threshold
3. THE InsuranceConfig SHALL define a minimum proposal amount threshold below which no bond is required
4. THE InsuranceConfig SHALL define minimum insurance as basis points of the proposal amount
5. THE InsuranceConfig SHALL define the slash percentage applied to rejected proposals
6. WHEN insurance is disabled, THE Vault SHALL allow proposals without requiring bonds

### Requirement 2: Bond Calculation

**User Story:** As a proposer, I want to know the required bond amount before creating a proposal, so that I can ensure I have sufficient funds to post the bond.

#### Acceptance Criteria

1. WHEN a proposal amount is below the minimum threshold, THE Vault SHALL require zero bond
2. WHEN a proposal amount meets or exceeds the minimum threshold, THE Vault SHALL calculate the required bond as a percentage of the proposal amount using the configured basis points
3. THE Vault SHALL ensure the calculated bond amount is at least the minimum required by the InsuranceConfig
4. WHEN calculating bonds, THE Vault SHALL handle integer arithmetic correctly to avoid rounding errors
5. THE Vault SHALL provide a method to query the required bond amount for a given proposal amount

### Requirement 3: Bond Posting

**User Story:** As a proposer, I want to post a bond when creating a proposal, so that my proposal can be submitted to the vault for approval.

#### Acceptance Criteria

1. WHEN creating a proposal that requires insurance, THE Vault SHALL verify the proposer has sufficient balance to cover the bond
2. WHEN the proposer has sufficient balance, THE Vault SHALL transfer the bond amount from the proposer to the Vault contract
3. WHEN the bond transfer succeeds, THE Vault SHALL record the bond amount in the Proposal structure
4. WHEN the proposer has insufficient balance, THE Vault SHALL reject the proposal creation and return an error
5. THE Vault SHALL emit an event indicating the bond amount posted and the proposal ID

### Requirement 4: Bond Slashing for Rejected Proposals

**User Story:** As a vault administrator, I want bonds to be slashed when proposals are rejected, so that malicious proposers face financial consequences.

#### Acceptance Criteria

1. WHEN a proposal is rejected, THE Vault SHALL calculate the slash amount as the configured slash percentage of the posted bond
2. WHEN the slash amount is calculated, THE Vault SHALL transfer the slashed amount to the Insurance_Pool
3. WHEN slashing occurs, THE Vault SHALL calculate the refund amount as the bond minus the slashed amount
4. WHEN the refund amount is greater than zero, THE Vault SHALL transfer the refund to the original proposer
5. THE Vault SHALL emit an event indicating the proposal ID, slashed amount, and refunded amount
6. WHEN a proposal with zero bond is rejected, THE Vault SHALL skip slashing logic

### Requirement 5: Bond Refund for Executed Proposals

**User Story:** As a proposer, I want my full bond refunded when my proposal is executed, so that I am not penalized for successful proposals.

#### Acceptance Criteria

1. WHEN a proposal is successfully executed, THE Vault SHALL refund the full bond amount to the proposer
2. WHEN the bond refund transfer succeeds, THE Vault SHALL update the proposal status to Executed
3. WHEN the bond refund transfer fails, THE Vault SHALL revert the entire execution transaction
4. THE Vault SHALL emit an event indicating the proposal ID and refunded bond amount
5. WHEN a proposal with zero bond is executed, THE Vault SHALL skip refund logic

### Requirement 6: Insurance Pool Management

**User Story:** As a vault administrator, I want to manage the insurance pool, so that slashed funds can be used to compensate the vault or fund operations.

#### Acceptance Criteria

1. THE Vault SHALL maintain a separate Insurance_Pool balance tracking all slashed bonds
2. WHEN bonds are slashed, THE Vault SHALL increment the Insurance_Pool balance by the slashed amount
3. THE Vault SHALL provide a method to query the current Insurance_Pool balance
4. WHEN an administrator withdraws from the Insurance_Pool, THE Vault SHALL verify the caller has admin privileges
5. WHEN an authorized withdrawal occurs, THE Vault SHALL transfer the requested amount from the Insurance_Pool to the specified recipient
6. THE Vault SHALL emit an event for all Insurance_Pool deposits and withdrawals

### Requirement 7: Bond Validation and Error Handling

**User Story:** As a developer, I want comprehensive error handling for bond operations, so that edge cases and failures are handled gracefully.

#### Acceptance Criteria

1. WHEN bond calculation overflows, THE Vault SHALL return an arithmetic error
2. WHEN a proposer attempts to create a proposal without sufficient balance for the bond, THE Vault SHALL return an insufficient balance error
3. WHEN bond transfer fails, THE Vault SHALL revert the proposal creation and return a transfer error
4. WHEN slashing calculation overflows, THE Vault SHALL return an arithmetic error
5. WHEN refund transfer fails during execution, THE Vault SHALL revert the entire transaction
6. THE Vault SHALL validate that slash percentage is between 0 and 100 during configuration

### Requirement 8: Integration with Existing Proposal Lifecycle

**User Story:** As a system architect, I want the insurance system to integrate seamlessly with the existing proposal lifecycle, so that existing functionality remains unaffected.

#### Acceptance Criteria

1. WHEN insurance is disabled, THE Vault SHALL process proposals exactly as before without bond requirements
2. WHEN a proposal is cancelled, THE Vault SHALL refund the full bond to the proposer without slashing
3. WHEN a proposal expires, THE Vault SHALL refund the full bond to the proposer without slashing
4. THE Vault SHALL ensure bond operations do not interfere with approval, voting, or timelock mechanisms
5. THE Vault SHALL maintain backward compatibility with proposals created before insurance was enabled

### Requirement 9: Bond Storage and Retrieval

**User Story:** As a developer, I want bond information stored efficiently, so that the system can scale with many proposals.

#### Acceptance Criteria

1. THE Proposal structure SHALL include an insurance_amount field storing the posted bond
2. WHEN querying a proposal, THE Vault SHALL return the insurance_amount as part of the proposal data
3. THE Vault SHALL store the Insurance_Pool balance in persistent storage
4. WHEN the contract is upgraded, THE Vault SHALL preserve all existing bond and Insurance_Pool data
5. THE Vault SHALL use efficient storage keys to minimize storage costs

### Requirement 10: Testing and Verification

**User Story:** As a quality assurance engineer, I want comprehensive tests for the insurance system, so that I can verify correctness and catch regressions.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for bond calculation with various amounts and configurations
2. THE test suite SHALL include tests for bond posting with sufficient and insufficient balances
3. THE test suite SHALL include tests for slashing logic with various slash percentages
4. THE test suite SHALL include tests for bond refunds on execution, cancellation, and expiration
5. THE test suite SHALL include tests for Insurance_Pool management and withdrawals
6. THE test suite SHALL include property-based tests verifying bond invariants across random inputs
7. THE test suite SHALL include integration tests verifying the complete proposal lifecycle with bonds
