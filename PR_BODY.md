## Description

This PR consolidates several critical backend and UI/UX improvements to enhance the stability, performance, and accessibility of VaultDAO. It introduces essential circuit breakers, upgrades health monitoring, improves data querying capabilities, and makes the application more accessible to all users.

### Changes Included
* **Health Check Deep Probe with Dependency Status**: Upgraded the `/api/v1/health/detailed` endpoint to actively probe external dependencies (Soroban RPC, Horizon, SQLite) and return their accurate, real-time status.
* **Transaction History Pagination and Filtering**: Enhanced the `GET /api/v1/transactions` endpoint to fully support server-side pagination and filtering, ensuring efficient data retrieval and reducing load for large vaults.
* **Soroban RPC Circuit Breaker**: Implemented a circuit breaker in the `EventPollingService` to pause retries during Soroban RPC node downtime or rate-limiting, preventing resource waste and cascading failures.
* **Keyboard Navigation and Screen Reader Accessibility**: Significantly improved interface accessibility by ensuring all interactive elements are fully navigable via keyboard and state changes are properly announced to screen reader users.

## Related Issues
Closes #985
Closes #982
Closes #981
Closes #966
