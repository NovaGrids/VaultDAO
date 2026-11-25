# CSV Export Policy

All CSV exports go through one serializer per package:

| Package  | Module                              | Used by                                              |
| -------- | ----------------------------------- | ---------------------------------------------------- |
| frontend | `frontend/src/utils/csv.ts`         | audit exporter, compliance/report generator, transactions, analytics, search, recipients |
| backend  | `backend/src/shared/utils/csv.ts`   | audit log streaming endpoint                         |

Both implementations are kept identical and are tested with the same payload vectors. Do not hand-roll `join(',')` serializers.

## Rules

- **RFC 4180 quoting.** A cell containing `,`, `"`, CR or LF is wrapped in double quotes and embedded quotes are doubled.
- **Formula neutralization.** A cell whose first character is `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` so spreadsheets read it as text. Neutralization runs before quoting. Negative numbers are exported as text for the same reason (`'-5`).
- **Streaming.** Use `csvRecords()` (lazy generator) with `csvToBlob()` in the browser or `writeCsvStream()` on the server. Pass generators, not pre-built arrays or strings, for large exports. `writeCsvStream` honours backpressure (`drain`).

## Charset and BOM

- Output is always UTF-8 and served as `text/csv; charset=utf-8`.
- No BOM by default. Pass `{ bom: true }` to `csvToBlob()` for audiences that open files in Excel and need non-ASCII text detected correctly.
- Line endings are CRLF (RFC 4180). The audit endpoint and a few legacy browser exports use LF for backward compatibility; consumers must accept both.

## Adding an export

1. Build rows as arrays (or a generator of arrays); the first record is the header.
2. Call the shared helper; never escape cells yourself.
3. Add a test with at least one formula payload (`=1+1`, `@SUM(A1)`) for the new export.
