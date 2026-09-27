# Backend

## Storage topology

The backend supports two storage backends, selected at runtime:

- **Postgres (production):** When `DATABASE_URL` is set, the backend connects to the
  provisioned RDS Postgres instance. This is the topology created by
  `terraform/main.tf`, which provisions an RDS Postgres instance and passes its
  connection string to the backend module as `database_url` / `DATABASE_URL`.
  Production data is persisted in RDS rather than on ephemeral container disk.
- **SQLite (local/dev fallback):** When `DATABASE_URL` is not set, the backend
  falls back to the SQLite database at `DATABASE_PATH`. This preserves the
  existing local and development workflow.

Selection order: `DATABASE_URL` (Postgres) takes precedence; otherwise
`DATABASE_PATH` (SQLite) is used.

## Configuration

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Set in production (provided by Terraform/RDS). |
| `DATABASE_PATH` | Path to the SQLite database file. Used when `DATABASE_URL` is unset. |
