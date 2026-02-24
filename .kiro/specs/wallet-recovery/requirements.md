# Requirements Document: Wallet Recovery Mechanism

## Introduction

This document specifies the requirements for a wallet recovery mechanism that prevents permanent loss of funds when private keys are lost or compromised. The system implements two recovery strategies: social recovery using trusted guardians and time-delayed recovery for emergency situations. The recovery mechanism is designed to balance security (preventing unauthorized access) with usability (enabling legitimate recovery), ensuring that lost keys do not result in permanently locked funds.

## Glossary

- **Vault**: The VaultDAO multi-signature treasury smart contract that holds and manages funds
- **Owner**: The primary address that controls the Vault and can initiate recovery processes
- **Guardian**: A trusted address designated by the Owner to participate in social recovery
- **Recovery_Proposal**: A formal request to change the Vault's ownership or control structure
- **Time_Delay**: A mandatory waiting period before a recovery action can be executed
- **Threshold**: The minimum number of Guardian approvals required to execute a social recovery
- **Recovery_Initiator**: The address that creates a Recovery_Proposal (can be Owner or Guardian)
- **Recovery_Window**: The time period during which a Recovery_Proposal remains valid and executable

## Requirements

### Requirement 1: Guardian System Management

**User Story:** As a Vault owner, I want to designate trusted guardians, so that I can recover my vault if I lose access to my keys.

#### Acceptance Criteria

1. THE Vault SHALL allow the Owner to add Guardian addresses to the guardian list
2. THE Vault SHALL allow the Owner to remove Guardian addresses from the guardian list
3. WHEN a Guardian is added, THE Vault SHALL store the Guardian address with an active status
4. WHEN a Guardian is removed, THE Vault SHALL mark the Guardian as inactive and prevent them from participating in future recoveries
5. THE Vault SHALL enforce a minimum of 2 Guardians before recovery functionality is enabled
6. THE Vault SHALL enforce a maximum of 10 Guardians to prevent excessive gas costs
7. THE Vault SHALL allow the Owner to configure the Guardian approval threshold (minimum number of Guardian approvals required)
8. WHEN the Guardian threshold is set, THE Vault SHALL validate that the threshold is at least 1 and does not exceed the total number of active Guardians

### Requirement 2: Social Recovery Initiation

**User Story:** As a guardian, I want to initiate a recovery process when the owner has lost their keys, so that the vault funds can be recovered to a new address.

#### Acceptance Criteria

1. WHEN a Guardian initiates recovery, THE Vault SHALL create a Recovery_Proposal with status Pending
2. WHEN creating a Recovery_Proposal, THE Vault SHALL record the new owner address, the initiating Guardian, and the creation timestamp
3. THE Vault SHALL prevent creating a new Recovery_Proposal if an active Recovery_Proposal already exists
4. WHEN a Recovery_Proposal is created, THE Vault SHALL calculate the unlock ledger as current ledger plus the configured time delay
5. THE Vault SHALL allow only active Guardians to initiate recovery
6. WHEN a Recovery_Proposal is created, THE Vault SHALL emit an event containing the proposal ID, new owner address, and unlock ledger

### Requirement 3: Guardian Approval Process

**User Story:** As a guardian, I want to approve recovery proposals initiated by other guardians, so that we can collectively authorize legitimate recovery attempts.

#### Acceptance Criteria

1. WHEN a Guardian approves a Recovery_Proposal, THE Vault SHALL add the Guardian address to the approval list
2. THE Vault SHALL prevent a Guardian from approving the same Recovery_Proposal multiple times
3. WHEN a Guardian approval is recorded, THE Vault SHALL check if the approval count meets the configured threshold
4. WHEN the approval threshold is met, THE Vault SHALL change the Recovery_Proposal status from Pending to Approved
5. THE Vault SHALL allow only active Guardians to approve Recovery_Proposals
6. WHEN a Guardian approves a Recovery_Proposal, THE Vault SHALL emit an event containing the proposal ID, approving Guardian, and current approval count

### Requirement 4: Time-Delayed Recovery Execution

**User Story:** As a system, I want to enforce a time delay before recovery execution, so that the legitimate owner has time to cancel fraudulent recovery attempts.

#### Acceptance Criteria

1. WHEN a Recovery_Proposal is approved, THE Vault SHALL enforce a time delay before execution is allowed
2. WHEN an execution attempt occurs before the unlock ledger, THE Vault SHALL reject the execution with an error
3. WHEN the current ledger is greater than or equal to the unlock ledger, THE Vault SHALL allow execution of the Recovery_Proposal
4. THE Vault SHALL configure the time delay as a number of ledgers (default: 120,960 ledgers, approximately 7 days)
5. WHEN a Recovery_Proposal is executed, THE Vault SHALL transfer ownership to the new owner address specified in the proposal
6. WHEN a Recovery_Proposal is executed, THE Vault SHALL mark the proposal status as Executed
7. WHEN a Recovery_Proposal is executed, THE Vault SHALL emit an event containing the proposal ID, new owner address, and execution timestamp

### Requirement 5: Recovery Cancellation

**User Story:** As a vault owner, I want to cancel fraudulent recovery attempts, so that I can prevent unauthorized access to my vault.

#### Acceptance Criteria

1. THE Vault SHALL allow the current Owner to cancel any Pending or Approved Recovery_Proposal
2. WHEN a Recovery_Proposal is cancelled, THE Vault SHALL change the proposal status to Cancelled
3. WHEN a Recovery_Proposal is cancelled, THE Vault SHALL prevent any further approvals or execution of that proposal
4. WHEN a Recovery_Proposal is cancelled, THE Vault SHALL emit an event containing the proposal ID and the cancelling address
5. THE Vault SHALL prevent cancellation of Recovery_Proposals that have already been executed

### Requirement 6: Recovery Proposal Expiration

**User Story:** As a system, I want recovery proposals to expire after a reasonable time, so that stale proposals do not remain executable indefinitely.

#### Acceptance Criteria

1. WHEN a Recovery_Proposal is created, THE Vault SHALL set an expiration ledger (default: 30 days from creation)
2. WHEN the current ledger exceeds the expiration ledger, THE Vault SHALL mark the Recovery_Proposal as Expired
3. WHEN a Recovery_Proposal is Expired, THE Vault SHALL prevent execution of the proposal
4. THE Vault SHALL allow expired proposals to be replaced by creating a new Recovery_Proposal
5. WHEN checking proposal status, THE Vault SHALL automatically update status to Expired if the expiration ledger has passed

### Requirement 7: Owner-Initiated Emergency Recovery

**User Story:** As a vault owner, I want to initiate a time-delayed ownership transfer to a backup address, so that I can recover my vault without guardian involvement if I lose my primary key but have a backup.

#### Acceptance Criteria

1. THE Vault SHALL allow the current Owner to initiate an emergency recovery to a new address
2. WHEN the Owner initiates emergency recovery, THE Vault SHALL create a Recovery_Proposal with the Owner as the initiator
3. WHEN an Owner-initiated Recovery_Proposal is created, THE Vault SHALL automatically mark it as Approved (no Guardian approvals needed)
4. WHEN an Owner-initiated Recovery_Proposal is created, THE Vault SHALL enforce the same time delay as Guardian-initiated recovery
5. THE Vault SHALL allow the Owner to cancel their own emergency recovery proposal before execution
6. WHEN an Owner-initiated emergency recovery is executed, THE Vault SHALL transfer ownership to the new address

### Requirement 8: Recovery State Validation

**User Story:** As a system, I want to validate recovery state transitions, so that the recovery process follows a secure and predictable workflow.

#### Acceptance Criteria

1. THE Vault SHALL enforce that Recovery_Proposals can only transition from Pending to Approved when the threshold is met
2. THE Vault SHALL enforce that Recovery_Proposals can only transition from Approved to Executed when the time delay has passed
3. THE Vault SHALL enforce that Recovery_Proposals can transition from Pending or Approved to Cancelled by the Owner
4. THE Vault SHALL enforce that Recovery_Proposals can transition to Expired when the expiration time is reached
5. THE Vault SHALL prevent any state transitions from Executed or Cancelled status
6. WHEN a state transition is invalid, THE Vault SHALL reject the operation with a descriptive error

### Requirement 9: Guardian Threshold Configuration

**User Story:** As a vault owner, I want to configure the number of guardian approvals required for recovery, so that I can balance security with availability.

#### Acceptance Criteria

1. THE Vault SHALL allow the Owner to set the Guardian approval threshold
2. WHEN the threshold is updated, THE Vault SHALL validate that the new threshold is at least 1
3. WHEN the threshold is updated, THE Vault SHALL validate that the new threshold does not exceed the number of active Guardians
4. THE Vault SHALL store the Guardian threshold in the Config type
5. WHEN calculating if a Recovery_Proposal is approved, THE Vault SHALL compare the approval count against the configured threshold
6. THE Vault SHALL emit an event when the Guardian threshold is updated

### Requirement 10: Recovery Proposal Query Functions

**User Story:** As a user or frontend application, I want to query recovery proposal details, so that I can display the current recovery status and history.

#### Acceptance Criteria

1. THE Vault SHALL provide a function to retrieve a Recovery_Proposal by its ID
2. THE Vault SHALL provide a function to check if an active Recovery_Proposal exists
3. THE Vault SHALL provide a function to list all Guardians for the Vault
4. THE Vault SHALL provide a function to check if a specific address is an active Guardian
5. THE Vault SHALL provide a function to retrieve the current Guardian approval threshold
6. WHEN querying a non-existent Recovery_Proposal, THE Vault SHALL return an error indicating the proposal was not found
