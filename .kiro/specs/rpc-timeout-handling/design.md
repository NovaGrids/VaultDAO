# Design Document: RPC Timeout Handling

## Overview

This design implements timeout protection for all RPC calls using the Web API's AbortController. A new utility function `fetchWithTimeout` wraps the native fetch API and enforces a configurable timeout (default 10 seconds). When a timeout occurs, the request is aborted and a descriptive TimeoutError is thrown. The EventPollingService integrates this utility to protect the polling loop from hanging on unresponsive RPC endpoints.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  EventPollingService                         │
│  (Polling Loop - poll() method)                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ calls
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              fetchWithTimeout()                              │
│  (Timeout Wrapper - backend/src/shared/http/)               │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Create AbortController                            │   │
│  │ 2. Set timeout to abort after N ms                   │   │
│  │ 3. Call fetch with signal                            │   │
│  │ 4. Return response or throw TimeoutError             │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ uses
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Native fetch API                                │
│  (Node.js built-in)                                          │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. TimeoutError Class

A custom error class that extends Error to represent timeout failures.

```typescript
class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}
```

**Properties:**
- `name`: Always "TimeoutError" for error type identification
- `message`: Descriptive message including URL and timeout duration

### 2. fetchWithTimeout Function

Location: `backend/src/shared/http/fetchWithTimeout.ts`

**Signature:**
```typescript
function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs?: number
): Promise<Response>
```

**Parameters:**
- `url` (string): The URL to fetch
- `options` (RequestInit, optional): Standard fetch options (headers, method, body, etc.)
- `timeoutMs` (number, optional): Timeout duration in milliseconds. Defaults to 10000 (10 seconds)

**Returns:**
- Promise<Response>: Resolves with the fetch response if successful before timeout
- Throws TimeoutError if timeout expires
- Throws original fetch error if request fails for other reasons

**Implementation Details:**
1. Create an AbortController instance
2. Set a timeout that calls `controller.abort()` after `timeoutMs` milliseconds
3. Pass `controller.signal` to fetch options
4. Wrap fetch call in try-catch to handle AbortError
5. Convert AbortError to TimeoutError with descriptive message
6. Clear the timeout after fetch completes (success or failure)

### 3. EventPollingService Integration

Location: `backend/src/modules/events/events.service.ts`

**Changes:**
- Import `fetchWithTimeout` from shared/http
- Replace direct fetch calls with `fetchWithTimeout(url, options, 10000)`
- Catch TimeoutError in the poll() method's error handler
- Log TimeoutError with context (URL, timeout duration, attempt number)
- Treat TimeoutError as a poll failure (increment consecutiveErrors)

**Error Handling Flow:**
```
poll() → fetchWithTimeout() → timeout expires
                              ↓
                         AbortError caught
                              ↓
                         TimeoutError thrown
                              ↓
                         poll() catch block
                              ↓
                         Log error + increment consecutiveErrors
                              ↓
                         scheduleNextPoll() with backoff
```

## Data Models

### TimeoutError

```typescript
interface TimeoutError extends Error {
  name: "TimeoutError";
  message: string; // "Request to {url} timed out after {timeoutMs}ms"
}
```

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Timeout Enforcement

*For any* URL and timeout duration, if the fetch request does not complete within the timeout window, the function SHALL throw a TimeoutError.

**Validates: Requirements 1.3, 1.5**

### Property 2: Successful Response Pass-Through

*For any* URL and timeout duration, if the fetch request completes successfully before the timeout expires, the function SHALL return the response without modification.

**Validates: Requirements 1.1, 1.2**

### Property 3: Non-Timeout Errors Propagate

*For any* URL and timeout duration, if the fetch request fails for reasons other than timeout (e.g., network error, DNS failure), the function SHALL throw the original error, not a TimeoutError.

**Validates: Requirements 1.6**

### Property 4: Default Timeout Applied

*For any* URL and options, if no timeout duration is provided, the function SHALL use a default timeout of 10 seconds (10000 milliseconds).

**Validates: Requirements 1.5**

### Property 5: Polling Service Continues After Timeout

*For any* EventPollingService instance, if a TimeoutError occurs during polling, the service SHALL catch the error, log it, and schedule the next poll with exponential backoff (not crash or hang).

**Validates: Requirements 2.5**

### Property 6: Timeout Error Includes Context

*For any* TimeoutError thrown, the error message SHALL include both the URL and the timeout duration in milliseconds.

**Validates: Requirements 3.1, 3.2**

## Error Handling

### Timeout Scenarios

1. **RPC Endpoint Unresponsive**: Request hangs indefinitely
   - AbortController timeout fires
   - AbortError caught and converted to TimeoutError
   - EventPollingService logs error and increments backoff

2. **Network Failure**: Connection refused, DNS failure, etc.
   - fetch throws original error
   - fetchWithTimeout propagates error unchanged
   - EventPollingService catches and logs

3. **Partial Response**: Server sends headers but no body
   - fetch may timeout waiting for body
   - AbortController timeout fires
   - TimeoutError thrown

### Error Recovery

- TimeoutError is treated as a transient failure
- EventPollingService increments consecutiveErrors
- Exponential backoff delays next poll (2^errors * baseInterval)
- Max backoff capped at 5 minutes
- Service continues running (no crash)

## Testing Strategy

### Unit Tests

**fetchWithTimeout Tests:**
- Test successful response returns before timeout
- Test timeout throws TimeoutError with correct message
- Test default timeout of 10 seconds is applied
- Test custom timeout is respected
- Test non-timeout errors propagate unchanged
- Test AbortController is properly cleaned up

**EventPollingService Tests:**
- Test poll() catches TimeoutError
- Test TimeoutError increments consecutiveErrors
- Test TimeoutError is logged with context
- Test polling continues after timeout (not hung)

### Property-Based Tests

**Property 1: Timeout Enforcement**
- Generate random URLs and timeout durations
- Mock fetch to delay response beyond timeout
- Verify TimeoutError is thrown
- Verify error message includes URL and timeout

**Property 2: Successful Response Pass-Through**
- Generate random URLs and timeout durations
- Mock fetch to return response before timeout
- Verify response is returned unchanged
- Verify no error is thrown

**Property 3: Non-Timeout Errors Propagate**
- Generate random URLs and error types
- Mock fetch to throw various errors (NetworkError, TypeError, etc.)
- Verify original error is thrown (not TimeoutError)

**Property 4: Default Timeout Applied**
- Generate random URLs without timeout parameter
- Mock fetch to delay response
- Verify default 10-second timeout is enforced

**Property 5: Polling Service Continues After Timeout**
- Start EventPollingService
- Mock RPC to timeout
- Verify service catches error and schedules next poll
- Verify service is still running (not hung)

**Property 6: Timeout Error Includes Context**
- Generate random URLs and timeout durations
- Throw TimeoutError
- Verify error message includes URL
- Verify error message includes timeout duration

## Testing Configuration

- Minimum 100 iterations per property test
- Mock fetch using Node.js test utilities
- Use fake timers to control timeout behavior
- Tag each test with: `Feature: rpc-timeout-handling, Property {number}: {property_text}`

</content>
</invoke>
