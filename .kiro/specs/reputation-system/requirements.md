# Requirements Document: Reputation System

## Introduction

The reputation system tracks and manages user reputation scores based on their proposal activities within the VaultDAO. The system incentivizes quality proposals by tracking success rates, approval rates, and execution rates. Reputation scores affect proposal priority and limits, rewarding good actors with increased privileges while maintaining quality control.

## Glossary

- **Reputation_System**: The subsystem responsible for tracking, calculating, and managing user reputation scores
- **Proposer**: A user who creates proposals in the VaultDAO
- **Signer**: A user authorized to approve proposals
- **Reputation_Score**: A numerical value (0-1000) representing a user's trustworthiness and track record
- **Success_Rate**: The percentage of a user's proposals that were successfully executed
- **Approval_Rate**: The percentage of a user's proposals that received sufficient approvals
- **Execution_Rate**: The percentage of approved proposals that were successfully executed
- **Reputation_Decay**: The gradual reduction of reputation scores over time to ensure recent activity is weighted more heavily
- **Reputation_History**: A record of reputation changes and the actions that caused them
- **Proposal_Limit**: The maximum number of active proposals a user can have based on their reputation
- **Priority_Boost**: An increase in proposal priority based on the proposer's reputation score

## Requirements

### Requirement 1: Reputation Score Tracking

**User Story:** As a VaultDAO participant, I want my reputation to be tracked based on my proposal activities, so that my reliability and contribution quality are reflected in the system.

#### Acceptance Criteria

1. THE Reputation_System SHALL maintain a Reputation_Score for each user ranging from 0 to 1000
2. WHEN a user first interacts with the system, THE Reputation_System SHALL initialize their Reputation_Score to 500 (neutral)
3. THE Reputation_System SHALL track the total number of proposals created by each user
4. THE Reputation_System SHALL track the total number of proposals executed for each user
5. THE Reputation_System SHALL track the total number of proposals rejected for each user
6. THE Reputation_System SHALL track the total number of approvals given by each Signer
7. THE Reputation_System SHALL store the ledger timestamp of the last reputation update for each user

### Requirement 2: Reputation Calculation Algorithm

**User Story:** As a system administrator, I want reputation scores to be calculated based on multiple factors, so that the scores accurately reflect user reliability and contribution quality.

#### Acceptance Criteria

1. WHEN a user creates a proposal, THE Reputation_System SHALL increment their proposals_created counter
2. WHEN a proposal is successfully executed, THE Reputation_System SHALL increase the proposer's Reputation_Score by 10 points
3. WHEN a proposal is successfully executed, THE Reputation_System SHALL increment the proposer's proposals_executed counter
4. WHEN a proposal is rejected, THE Reputation_System SHALL decrease the proposer's Reputation_Score by 5 points
5. WHEN a proposal is rejected, THE Reputation_System SHALL increment the proposer's proposals_rejected counter
6. WHEN a Signer approves a proposal, THE Reputation_System SHALL increment their approvals_given counter
7. WHEN a Signer approves a proposal that is later executed, THE Reputation_System SHALL increase their Reputation_Score by 2 points
8. THE Reputation_System SHALL ensure Reputation_Score never exceeds 1000
9. THE Reputation_System SHALL ensure Reputation_Score never falls below 0

### Requirement 3: Success Rate Calculation

**User Story:** As a VaultDAO participant, I want my success rate to be accurately calculated, so that my track record is properly represented.

#### Acceptance Criteria

1. THE Reputation_System SHALL calculate Success_Rate as (proposals_executed / proposals_created) × 100
2. WHEN a user has created zero proposals, THE Reputation_System SHALL return a Success_Rate of 0
3. THE Reputation_System SHALL provide a method to retrieve a user's current Success_Rate
4. THE Reputation_System SHALL calculate Success_Rate with precision to two decimal places

### Requirement 4: Reputation-Based Proposal Limits

**User Story:** As a system administrator, I want to limit the number of active proposals based on reputation, so that users with poor track records cannot spam the system.

#### Acceptance Criteria

1. WHEN a user's Reputation_Score is below 300, THE Reputation_System SHALL set their Proposal_Limit to 1
2. WHEN a user's Reputation_Score is between 300 and 599, THE Reputation_System SHALL set their Proposal_Limit to 3
3. WHEN a user's Reputation_Score is between 600 and 799, THE Reputation_System SHALL set their Proposal_Limit to 5
4. WHEN a user's Reputation_Score is 800 or above, THE Reputation_System SHALL set their Proposal_Limit to 10
5. WHEN a user attempts to create a proposal, THE Reputation_System SHALL verify they have not exceeded their Proposal_Limit
6. WHEN a user has reached their Proposal_Limit, THE Reputation_System SHALL prevent proposal creation and return an error

### Requirement 5: Reputation-Based Priority

**User Story:** As a VaultDAO participant with high reputation, I want my proposals to receive priority, so that my reliable contributions are processed more efficiently.

#### Acceptance Criteria

1. WHEN a proposal is created by a user with Reputation_Score above 700, THE Reputation_System SHALL automatically set the proposal priority to High
2. WHEN a proposal is created by a user with Reputation_Score between 400 and 700, THE Reputation_System SHALL set the proposal priority to Medium
3. WHEN a proposal is created by a user with Reputation_Score below 400, THE Reputation_System SHALL set the proposal priority to Low
4. THE Reputation_System SHALL allow manual priority changes to override reputation-based priority

### Requirement 6: Reputation Decay Over Time

**User Story:** As a system administrator, I want reputation scores to decay over time, so that recent activity is weighted more heavily than historical activity.

#### Acceptance Criteria

1. THE Reputation_System SHALL apply reputation decay when a user's reputation is accessed after a period of inactivity
2. WHEN 30 days (approximately 2,592,000 ledgers) have passed since last_decay_ledger, THE Reputation_System SHALL reduce the Reputation_Score by 5%
3. WHEN decay is applied, THE Reputation_System SHALL update the last_decay_ledger to the current ledger
4. THE Reputation_System SHALL apply decay cumulatively for multiple 30-day periods
5. THE Reputation_System SHALL ensure decay never reduces Reputation_Score below 100
6. WHEN a user performs any reputation-affecting action, THE Reputation_System SHALL apply pending decay before updating the score

### Requirement 7: Reputation History Tracking

**User Story:** As a VaultDAO participant, I want to view my reputation history, so that I can understand how my actions have affected my reputation over time.

#### Acceptance Criteria

1. THE Reputation_System SHALL maintain a history of reputation changes for each user
2. WHEN a reputation change occurs, THE Reputation_System SHALL record the ledger timestamp, old score, new score, and reason for change
3. THE Reputation_System SHALL limit reputation history to the most recent 50 entries per user
4. THE Reputation_System SHALL provide a method to retrieve a user's reputation history
5. WHEN history exceeds 50 entries, THE Reputation_System SHALL remove the oldest entry before adding a new one

### Requirement 8: Reputation Query Interface

**User Story:** As a developer integrating with VaultDAO, I want to query reputation information, so that I can display user reputation in external interfaces.

#### Acceptance Criteria

1. THE Reputation_System SHALL provide a method to retrieve a user's complete Reputation data structure
2. THE Reputation_System SHALL provide a method to retrieve a user's current Reputation_Score
3. THE Reputation_System SHALL provide a method to retrieve a user's Success_Rate
4. THE Reputation_System SHALL provide a method to retrieve a user's current Proposal_Limit
5. THE Reputation_System SHALL apply any pending decay before returning reputation data

### Requirement 9: Reputation Initialization and Reset

**User Story:** As a system administrator, I want the ability to reset or adjust reputation scores in exceptional circumstances, so that I can correct errors or handle edge cases.

#### Acceptance Criteria

1. WHEN an admin resets a user's reputation, THE Reputation_System SHALL set all counters to zero and Reputation_Score to 500
2. WHEN an admin resets a user's reputation, THE Reputation_System SHALL record the reset in the reputation history
3. THE Reputation_System SHALL restrict reputation reset functionality to admin role only
4. THE Reputation_System SHALL emit an event when a reputation is manually reset

### Requirement 10: Integration with Proposal Lifecycle

**User Story:** As a VaultDAO participant, I want reputation updates to happen automatically during proposal lifecycle events, so that my reputation stays current without manual intervention.

#### Acceptance Criteria

1. WHEN a proposal is created, THE Reputation_System SHALL automatically update the proposer's reputation
2. WHEN a proposal is approved, THE Reputation_System SHALL automatically update the approver's reputation
3. WHEN a proposal is executed, THE Reputation_System SHALL automatically update both proposer and approver reputations
4. WHEN a proposal is rejected, THE Reputation_System SHALL automatically update the proposer's reputation
5. WHEN a proposal is cancelled by the proposer, THE Reputation_System SHALL not affect the proposer's reputation
6. THE Reputation_System SHALL ensure all reputation updates are atomic with the proposal state change
