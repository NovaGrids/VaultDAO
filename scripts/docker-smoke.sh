#!/usr/bin/env bash
# ==============================================================================
# VaultDAO — Docker production smoke test + security header regression
# ==============================================================================
#
# Usage:
#   ./scripts/docker-smoke.sh [frontend_url] [backend_url]
#
# Defaults:
#   frontend_url  http://localhost:80
#   backend_url   http://localhost:8787
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed (details printed to stderr)
#
# Checks performed:
#   1.  Frontend /         returns HTTP 200
#   2.  Frontend /healthz  returns HTTP 200 with body "ok"
#   3.  Frontend SPA fallback (/some/deep/route) returns HTTP 200 (not 404)
#   4.  Backend  /health   returns HTTP 200
#   5.  Backend  /api/v1/templates returns HTTP 200
#   6.  Security headers present on frontend responses:
#         X-Frame-Options: DENY
#         X-Content-Type-Options: nosniff
#         Referrer-Policy: strict-origin-when-cross-origin
#         Content-Security-Policy (presence only)
#         Strict-Transport-Security (presence only)
#   7.  index.html served with Cache-Control: no-store (not cached)
#   8.  A hashed JS bundle is served with Cache-Control: public, immutable
#
# ==============================================================================

set -euo pipefail

FRONTEND_URL="${1:-http://localhost:80}"
BACKEND_URL="${2:-http://localhost:8787}"

PASS=0
FAIL=0

# Colours
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}  PASS${NC}  $1"; ((PASS++)); }
fail() { echo -e "${RED}  FAIL${NC}  $1" >&2; ((FAIL++)); }
info() { echo -e "${YELLOW}  ----${NC}  $1"; }

# ---------------------------------------------------------------------------
# Helper: fetch headers + status for a URL
# ---------------------------------------------------------------------------
fetch() {
  # Returns: "STATUS_CODE\nHEADERS"
  curl -sS --max-time 10 -D - -o /dev/null "$@"
}

check_status() {
  local label="$1" url="$2" expected="$3"
  local actual
  actual=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$url")
  if [[ "$actual" == "$expected" ]]; then
    pass "$label — HTTP $actual"
  else
    fail "$label — expected HTTP $expected, got HTTP $actual (URL: $url)"
  fi
}

check_header() {
  local label="$1" url="$2" header="$3" expected_pattern="$4"
  local headers
  headers=$(curl -sS --max-time 10 -D - -o /dev/null "$url" 2>&1)
  if echo "$headers" | grep -qi "$header"; then
    if echo "$headers" | grep -qi "$expected_pattern"; then
      pass "$label — header '$header' matches '$expected_pattern'"
    else
      actual_val=$(echo "$headers" | grep -i "$header" | head -1 | tr -d '\r')
      fail "$label — header '$header' present but value mismatch. Got: $actual_val"
    fi
  else
    fail "$label — header '$header' missing"
  fi
}

check_header_present() {
  local label="$1" url="$2" header="$3"
  local headers
  headers=$(curl -sS --max-time 10 -D - -o /dev/null "$url" 2>&1)
  if echo "$headers" | grep -qi "$header:"; then
    pass "$label — header '$header' present"
  else
    fail "$label — header '$header' missing"
  fi
}

check_body_contains() {
  local label="$1" url="$2" pattern="$3"
  local body
  body=$(curl -sS --max-time 10 "$url")
  if echo "$body" | grep -q "$pattern"; then
    pass "$label — body contains '$pattern'"
  else
    fail "$label — body does not contain '$pattern'"
  fi
}

# ---------------------------------------------------------------------------
# Wait for services to be ready (up to 60s)
# ---------------------------------------------------------------------------
info "Waiting for frontend at $FRONTEND_URL ..."
for i in $(seq 1 30); do
  if curl -sS --max-time 3 -o /dev/null "$FRONTEND_URL/healthz" 2>/dev/null; then
    break
  fi
  sleep 2
done

info "Waiting for backend at $BACKEND_URL ..."
for i in $(seq 1 30); do
  if curl -sS --max-time 3 -o /dev/null "$BACKEND_URL/health" 2>/dev/null; then
    break
  fi
  sleep 2
done

echo ""
echo "════════════════════════════════════════════"
echo "  VaultDAO Docker Smoke Test"
echo "  Frontend: $FRONTEND_URL"
echo "  Backend:  $BACKEND_URL"
echo "════════════════════════════════════════════"
echo ""

# ---------------------------------------------------------------------------
# 1. HTTP status checks
# ---------------------------------------------------------------------------
info "HTTP status checks"
check_status "Frontend root"            "$FRONTEND_URL/"               200
check_status "Frontend healthz"         "$FRONTEND_URL/healthz"        200
check_status "Frontend SPA fallback"    "$FRONTEND_URL/proposals/42"   200
check_status "Backend health"           "$BACKEND_URL/health"          200
check_status "Backend templates API"    "$BACKEND_URL/api/v1/templates" 200

# ---------------------------------------------------------------------------
# 2. SPA fallback body check (must serve index.html, not a 404 page)
# ---------------------------------------------------------------------------
info "SPA fallback content"
check_body_contains "SPA fallback serves index.html" \
  "$FRONTEND_URL/proposals/42" \
  "<div id=\"root\""

# ---------------------------------------------------------------------------
# 3. Security headers
# ---------------------------------------------------------------------------
info "Security headers on frontend root"
check_header         "X-Frame-Options"            "$FRONTEND_URL/" "x-frame-options"           "DENY"
check_header         "X-Content-Type-Options"     "$FRONTEND_URL/" "x-content-type-options"    "nosniff"
check_header         "Referrer-Policy"            "$FRONTEND_URL/" "referrer-policy"            "strict-origin"
check_header_present "Content-Security-Policy"    "$FRONTEND_URL/" "content-security-policy"
check_header_present "Strict-Transport-Security"  "$FRONTEND_URL/" "strict-transport-security"
check_header_present "Permissions-Policy"         "$FRONTEND_URL/" "permissions-policy"

# ---------------------------------------------------------------------------
# 4. Cache-Control headers
# ---------------------------------------------------------------------------
info "Cache-Control headers"
check_header "index.html is not cached" \
  "$FRONTEND_URL/" \
  "cache-control" \
  "no-store"

# Find the first hashed JS asset reference in index.html and test its headers.
JS_ASSET=$(curl -sS --max-time 10 "$FRONTEND_URL/" | \
  grep -oP '/assets/[^"]+\.js' | head -1 || true)

if [[ -n "$JS_ASSET" ]]; then
  check_header "Hashed JS chunk is immutable" \
    "$FRONTEND_URL$JS_ASSET" \
    "cache-control" \
    "immutable"
else
  info "No hashed JS asset found in index.html — skipping immutable cache check"
fi

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------
echo ""
echo "════════════════════════════════════════════"
echo -e "  ${GREEN}PASS: $PASS${NC}   ${RED}FAIL: $FAIL${NC}"
echo "════════════════════════════════════════════"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}Smoke test FAILED — $FAIL check(s) did not pass.${NC}" >&2
  exit 1
fi

echo -e "${GREEN}All checks passed.${NC}"
exit 0
