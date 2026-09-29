#!/usr/bin/env bash
# Fails when a contract test file exists without a `mod` declaration in
# src/lib.rs. Undeclared files are never compiled, so their coverage is
# silently lost. Quarantined modules live in src/quarantine/ instead.
#
# Usage: scripts/check_test_modules.sh   (run from contracts/vault)
set -euo pipefail

cd "$(dirname "$0")/.."

missing=()
count=0
for file in src/test*.rs; do
  count=$((count + 1))
  name="$(basename "$file" .rs)"
  # Only uncommented declarations count, e.g. `mod test_foo;` or `pub mod test_foo;`.
  if ! grep -Eq "^[[:space:]]*(pub[[:space:]]+)?mod[[:space:]]+${name}[[:space:]]*;" src/lib.rs; then
    missing+=("$file")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "Test files without a mod declaration in src/lib.rs:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Declare them under #[cfg(test)], or move them to src/quarantine/ and" >&2
  echo "list them in docs/reference/TESTING.md." >&2
  exit 1
fi

echo "All ${count} src/test*.rs files are declared in src/lib.rs."
