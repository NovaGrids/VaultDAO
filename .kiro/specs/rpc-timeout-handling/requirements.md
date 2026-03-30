# Requirements Document: RPC Timeout Handling

## Introduction

When real Soroban RPC calls are implemented, fetch will be used with no timeout. A slow or unresponsive RPC endpoint will cause the polling promise to hang indefinitely, eventually exhausting the Node.js async queue and preventing new polls from starting. This feature adds timeout protection to all RPC calls to prevent resource exhaustion.

## Glossary

- **RPC**: Remote Procedure Call endpoint (Soroban RPC)
- **AbortController**: Web API for cancelling fetch requests
- **TimeoutError**: Custom error thrown when a request exceeds the timeout duration
- **Fetch**: Native Node.js HTTP client for making requests
- **Polling Service**: EventPollingService that periodically queries the RPC for contract events

## Requirements

### Requirement 1: Timeout Utility Function

**User Story:** As a backend developer, I want a reusable timeout wrapper for fetch requests, so that I can protect all RPC calls from hanging indefinitely.

#### Acceptance Criteria

1. WHEN `fetchWithTimeout` is called with a URL, options, and timeout duration THEN the function SHALL return a Promise that resolves with the fetch response
2. WHEN the fetch request completes before the timeout expires THEN the function SHALL return the response without throwing an error
3. WHEN the timeout duration expires before the fetch completes THEN the function SHALL abort the request and throw a TimeoutError
4. WHEN a TimeoutError is thrown THEN it SHALL include a descriptive message indicating the timeout occurred
5. WHEN `fetchWithTimeout` is called without a timeout parameter THEN it SHALL use a default timeout of 10 seconds
6. WHEN the fetch request fails for reasons other than timeout THEN the function SHALL propagate the original error

### Requirement 2: RPC Call Integration

**User Story:** As a backend developer, I want all RPC calls to use the timeout wrapper, so that the polling service never hangs on unresponsive endpoints.

#### Acceptance Criteria

1. WHEN EventPollingService.poll() makes an RPC call THEN it SHALL use `fetchWithTimeout` with the default 10-second timeout
2. WHEN an RPC call times out THEN EventPollingService SHALL catch the TimeoutError and treat it as a poll failure
3. WHEN a TimeoutError occurs THEN EventPollingService SHALL log the timeout with context (URL, timeout duration)
4. WHEN a TimeoutError occurs THEN EventPollingService SHALL increment consecutiveErrors for exponential backoff
5. WHEN a TimeoutError occurs THEN EventPollingService SHALL continue the polling loop (not crash)

### Requirement 3: Error Handling and Logging

**User Story:** As an operator, I want clear visibility into timeout events, so that I can diagnose RPC endpoint issues.

#### Acceptance Criteria

1. WHEN a TimeoutError is thrown THEN the error message SHALL include the URL that timed out
2. WHEN a TimeoutError is thrown THEN the error message SHALL include the timeout duration in milliseconds
3. WHEN EventPollingService catches a TimeoutError THEN it SHALL log the error at ERROR level with context
4. WHEN EventPollingService catches a TimeoutError THEN the log entry SHALL include the RPC URL and timeout duration
5. WHEN EventPollingService catches a TimeoutError THEN the log entry SHALL include the attempt number (consecutiveErrors)

</content>
</invoke>