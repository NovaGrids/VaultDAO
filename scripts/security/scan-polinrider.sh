#!/usr/bin/env bash
# PolinRider / Contagious Interview indicator scanner for VaultDAO (read-only).
#
# Safe by design:
#   - never executes scanned files
#   - never installs dependencies
#   - never reads or uses secrets
#   - scans tracked / untracked-but-not-ignored files (git is the source of truth),
#     falling back to a pruned filesystem walk outside a git work tree
#
# Modes:
#   repo       full scan (default)
#   pr-files   additionally fail on high-risk paths in $POLIN_CHANGED_FILES
#   self-test  prove detection with inert fixtures (positive + negative cases)
#
# Exit codes: 0 = clean (warnings allowed), 1 = confirmed findings, 2 = usage/setup error.
set -euo pipefail

ROOT="${1:-.}"
MODE="${2:-repo}" # repo | pr-files | self-test
FAIL=0
WARN=0
REPORT=()

note() { REPORT+=("$1"); }
fail() { FAIL=1; note "CONFIRMED: $1"; echo "::error::$1"; }
warn() { WARN=1; note "REVIEW: $1"; echo "::warning::$1"; }

# Resolve our own absolute path before cd so self-test can re-invoke us.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$ROOT"

# ---------------------------------------------------------------------------
# File enumeration
# ---------------------------------------------------------------------------
# Inside a repository we rely on git: tracked files plus untracked files that
# are not ignored. Ignored local state (backend/.env, dist/, node_modules/,
# target/) is deliberately out of scope — git history is what gets executed by
# CI and reviewers. Outside git (self-test temp trees) we fall back to find.
list_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files -z --cached --others --exclude-standard
  else
    find . \
      \( -name node_modules -o -name .git -o -name target -o -name dist \
         -o -name coverage -o -name .next -o -name playwright-report \
         -o -name test-results -o -name .turbo \) -prune \
      -o -type f -print0
  fi
}

# Files that intentionally contain detection markers: fixtures, this scanner,
# its documentation, and the workflow. Excluded from every content rule.
EXCLUDE_RE='^(\./)?(security/fixtures/|scripts/security/|docs/SECURITY_POLINRIDER\.md$|\.github/workflows/polinrider-security\.yml$)'

# Scanable file list (NUL-delimited), self-exclusions applied.
scan_files() {
  list_files | grep -zvE "$EXCLUDE_RE" || true
}

# content_grep [-i] [-e] PATTERN... -> prints "file:line:content" hits.
# -a: also scan binary files (malware often hides in binaries).
# content_grep [-i] [-e] [-nomd] PATTERN... -> prints "file:line:content" hits.
#   -i     case-insensitive
#   -nomd  skip *.md / *.txt (documentation legitimately quotes install lines,
#          IoC write-ups, etc. — broader heuristics don't apply to prose)
#   -a     also scan binary files (malware often hides in binaries)
content_grep() {
  local flags=(-nEa)
  local args=()
  local nomd=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -i) flags+=(-i); shift ;;
      -nomd) nomd=1; shift ;;
      -e) shift; args+=(-e "$1"); shift ;;
      *)  args+=(-e "$1"); shift ;;
    esac
  done
  if [[ ${#args[@]} -eq 0 ]]; then return 0; fi
  local out
  out=$(scan_files | xargs -0 -r grep "${flags[@]}" "${args[@]}" -- 2>/dev/null || true)
  if [[ "$nomd" -eq 1 && -n "$out" ]]; then
    out=$(printf '%s\n' "$out" | grep -vE '\.(md|txt):[0-9]+:' || true)
  fi
  printf '%s' "$out"
}

echo "## PolinRider security scan"
echo "Root: $(pwd)  Mode: $MODE"
echo

# ---------------------------------------------------------------------------
# self-test: nested scans over inert fixtures (negative case then positive)
# ---------------------------------------------------------------------------
if [[ "$MODE" == "self-test" ]]; then
  FIX="$(cd "$(dirname "$SELF")/../../security/fixtures/polinrider" 2>/dev/null && pwd || true)"
  if [[ -z "$FIX" || ! -d "$FIX" ]]; then
    echo "Missing fixtures directory security/fixtures/polinrider"
    exit 2
  fi
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  # Negative case: clean fixture must produce a clean scan (exit 0).
  mkdir -p "$TMP/clean"
  cp "$FIX/clean-sample.js" "$TMP/clean/"
  clean_rc=0
  bash "$SELF" "$TMP/clean" repo >/dev/null 2>&1 || clean_rc=$?
  if [[ "$clean_rc" -ne 0 ]]; then
    echo "SELF-TEST FAILED: clean fixture tree produced exit $clean_rc (expected 0)"
    bash "$SELF" "$TMP/clean" repo || true
    exit 1
  fi
  echo "SELF-TEST PASS (negative): clean fixture tree scanned clean."

  # Positive case: every fixture class must be detected (exit 1).
  mkdir -p "$TMP/malicious/public/fonts" "$TMP/malicious/.vscode"
  cp "$FIX/fa-solid-400.woff2" "$TMP/malicious/public/fonts/"
  cp "$FIX/tasks.json" "$TMP/malicious/.vscode/tasks.json"
  cp "$FIX/tailwind.config.js" "$TMP/malicious/"
  cp "$FIX/lifecycle-package.json" "$TMP/malicious/package.json"
  cp "$FIX/obfuscated.js" "$TMP/malicious/"
  cp "$FIX/credential-theft.js" "$TMP/malicious/"
  { cat "$FIX/gitignore.snippet"; echo; } > "$TMP/malicious/.gitignore"

  mal_rc=0
  bash "$SELF" "$TMP/malicious" repo >"$TMP/malicious.log" 2>&1 || mal_rc=$?
  if [[ "$mal_rc" -eq 0 ]]; then
    echo "SELF-TEST FAILED: fixture tree was NOT detected (expected exit 1). Scanner output:"
    cat "$TMP/malicious.log"
    exit 1
  fi
  echo "SELF-TEST PASS (positive): fixture tree detected (nested exit $mal_rc). Findings:"
  grep -E '^(CONFIRMED|REVIEW)' "$TMP/malicious.log" || true
  echo
  echo "Self-test complete: negative and positive cases behave as expected."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1) PolinRider IoC markers (case-insensitive, includes binary content)
# ---------------------------------------------------------------------------
MARKER_PATTERNS=(
  'rmcej%otb%'
  '\$_1e42'
  'global\["!"\]'
  'global\["_V"\]'
  'global\.i="A'
  'temp_auto_push\.bat'
  'temp_interactive_push\.bat'
  'DEV#POPPER'
  'OmniSteal'
)
HITS=$(content_grep -i "${MARKER_PATTERNS[@]}")
if [[ -n "$HITS" ]]; then
  fail "PolinRider code markers found in repository content"
  echo "$HITS" | head -50
fi

# The campaign's decoy font filename alone is not proof (a legitimate
# Font Awesome asset is possible); text content in a font file is (rule 5),
# and a reference to it is surfaced here for context.
FONTNAME=$(content_grep 'fa-solid-400\.woff2')
if [[ -n "$FONTNAME" ]]; then
  warn "Reference to PolinRider decoy font name 'fa-solid-400.woff2' — verify origin"
  echo "$FONTNAME" | head -10
fi

# ---------------------------------------------------------------------------
# 2) VS Code folderOpen auto-run (classic PolinRider trigger)
#    Scans every tracked .vscode/tasks.json, not just the repo root.
# ---------------------------------------------------------------------------
TASKTMP=$(mktemp)
trap 'rm -f "$TASKTMP"' EXIT
scan_files | grep -zE '(^|/)\.vscode/tasks\.json$' > "$TASKTMP" || true
if [[ -s "$TASKTMP" ]]; then
  while IFS= read -r -d '' tf; do
    [[ -f "$tf" ]] || continue
    if grep -qi 'folderOpen' "$tf" 2>/dev/null; then
      if grep -qiE 'node[^"'"'"']*\.(woff2|woff|ttf|otf|eot|png|jpg|svg)' "$tf" 2>/dev/null; then
        fail "$tf runs node on a non-JS asset via folderOpen (PolinRider pattern)"
        grep -nE 'folderOpen|node' "$tf" | head -10 || true
      else
        warn "$tf uses runOn folderOpen — verify the command is legitimate"
        grep -nE 'folderOpen' "$tf" | head -5 || true
      fi
    fi
  done < "$TASKTMP"
fi
rm -f "$TASKTMP"

# ---------------------------------------------------------------------------
# 3) .gitignore fingerprint
# ---------------------------------------------------------------------------
GITTMP=$(mktemp)
trap 'rm -f "$GITTMP"' EXIT
scan_files | grep -zE '(^|/)\.gitignore$' > "$GITTMP" || true
if [[ -s "$GITTMP" ]]; then
  while IFS= read -r -d '' gi; do
    [[ -f "$gi" ]] || continue
    if grep -qE 'temp_auto_push|temp_interactive_push' "$gi" 2>/dev/null; then
      fail "$gi references temp_auto_push / temp_interactive_push (PolinRider fingerprint)"
      grep -nE 'temp_auto_push|temp_interactive_push' "$gi" | head -5 || true
    fi
  done < "$GITTMP"
fi
rm -f "$GITTMP"

# ---------------------------------------------------------------------------
# 4) Windows batch helpers (repo-wide file presence)
# ---------------------------------------------------------------------------
scan_files | while IFS= read -r -d '' f; do
  base=$(basename "$f")
  case "$base" in
    temp_auto_push.bat|temp_interactive_push.bat)
      echo "__POLIN_FAIL__ Malicious helper batch file present: $f"
      ;;
    *.bat|*.cmd)
      echo "__POLIN_WARN__ Unexpected Windows batch file in tree: $f — verify legitimacy"
      ;;
  esac
done > /tmp/polintrider_batch.$$ || true
if grep -q '^__POLIN_FAIL__' /tmp/polintrider_batch.$$ 2>/dev/null; then
  while IFS= read -r line; do
    fail "${line#__POLIN_FAIL__ }"
  done < <(grep '^__POLIN_FAIL__' /tmp/polintrider_batch.$$)
fi
if grep -q '^__POLIN_WARN__' /tmp/polintrider_batch.$$ 2>/dev/null; then
  while IFS= read -r line; do
    warn "${line#__POLIN_WARN__ }"
  done < <(grep '^__POLIN_WARN__' /tmp/polintrider_batch.$$)
fi
rm -f /tmp/polintrider_batch.$$

# ---------------------------------------------------------------------------
# 5) Fake fonts: font-named file whose content is text/JS, or contains markers
# ---------------------------------------------------------------------------
if command -v file >/dev/null 2>&1; then
  scan_files | grep -zE '\.(woff2?|ttf|otf|eot)$' > /tmp/polintrider_fonts.$$ || true
  if [[ -s /tmp/polintrider_fonts.$$ ]]; then
    while IFS= read -r -d '' f; do
      [[ -f "$f" ]] || continue
      ft=$(file -b "$f" 2>/dev/null || echo unknown)
      case "$ft" in
        *ASCII*|*UTF-8*|*text*|*JavaScript*|*JSON*|*empty*)
          if grep -qaIiE "$(IFS='|'; echo "${MARKER_PATTERNS[*]}")" "$f" 2>/dev/null; then
            fail "Font-named file contains PolinRider markers and is text/JS: $f ($ft)"
          else
            fail "Font-named file is text/JS (not a real font): $f ($ft)"
          fi
          ;;
      esac
    done < /tmp/polintrider_fonts.$$
  fi
  rm -f /tmp/polintrider_fonts.$$
else
  warn "file(1) not available — font content check skipped"
fi

# ---------------------------------------------------------------------------
# 6) Common malware drop paths
# ---------------------------------------------------------------------------
scan_files | grep -zE '(^|/)dist/setup\.js$' > /tmp/polintrider_drop.$$ || true
if [[ -s /tmp/polintrider_drop.$$ ]]; then
  while IFS= read -r -d '' f; do
    fail "Unexpected $f present (common malware drop path)"
  done < /tmp/polintrider_drop.$$
fi
rm -f /tmp/polintrider_drop.$$

# ---------------------------------------------------------------------------
# 7) Suspicious npm lifecycle scripts (every package.json in the repo)
#    VaultDAO has root/backend/frontend/sdk manifests.
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  LIFECYCLE_HITS=""
  while IFS= read -r -d '' pj; do
    [[ -f "$pj" ]] || continue
    out=$(PKG_PATH="$pj" python3 - <<'PY' 2>/dev/null || true
import json, os, re, sys
try:
    d = json.load(open(os.environ["PKG_PATH"]))
except Exception:
    sys.exit(0)
scripts = d.get("scripts") or {}
bad = re.compile(
    r"(curl\s+[^|]*\|\s*(ba|z|da)?sh|wget\s+[^|]*\|\s*(ba|z|da)?sh"
    r"|node\s+-e|eval\s*\(|child_process|invoke-expression|powershell\s+-enc)",
    re.I,
)
lifecycle = re.compile(r"(pre|post)?(install|publish|prepare)", re.I)
for k, v in scripts.items():
    if lifecycle.search(k) and bad.search(str(v)):
        print("%s: %s = %s" % (os.environ["PKG_PATH"], k, v))
PY
)
    if [[ -n "$out" ]]; then
      LIFECYCLE_HITS+="$out"$'\n'
    fi
  done < <(scan_files | grep -zE '(^|/)package\.json$' || true)
  if [[ -n "$LIFECYCLE_HITS" ]]; then
    fail "package.json contains lifecycle script that downloads/executes remote code"
    printf '%s' "$LIFECYCLE_HITS"
  fi
else
  warn "python3 not available — package.json lifecycle check skipped"
fi

# ---------------------------------------------------------------------------
# 8) Build configs with extreme line length (inline payload append variant)
# ---------------------------------------------------------------------------
CONFIG_RE='\.(config\.(js|mjs|cjs|ts)|postcss\.config\.[cm]?js|tailwind\.config\.[cm]?js|vite\.config\.[cm]?ts|babel\.config\.[cm]?js|jest\.config\.[cm]?js|next\.config\.[cm]?js|eslint\.config\.[cm]?ts|playwright\.config\.[cm]?ts|vitest\.config\.[cm]?ts)$'
scan_files | grep -zE "$CONFIG_RE" > /tmp/polintrider_cfg.$$ || true
if [[ -s /tmp/polintrider_cfg.$$ ]]; then
  while IFS= read -r -d '' f; do
    [[ -f "$f" ]] || continue
    if awk 'length($0)>2000 { found=1 } END { exit found?0:1 }' "$f"; then
      if grep -qaE "$(IFS='|'; echo "${MARKER_PATTERNS[*]}")|global\[|eval\(" "$f" 2>/dev/null; then
        fail "Build config has extreme line length with obfuscation markers: $f"
      else
        warn "Build config has extreme line length (>2000 chars): $f — verify no appended payload"
      fi
    fi
  done < /tmp/polintrider_cfg.$$
fi
rm -f /tmp/polintrider_cfg.$$

# ---------------------------------------------------------------------------
# 9) Broader supply-chain / malware heuristics, tuned for this codebase
#    (SQLite db.exec, Redis eval(), frontend atob() and the Docker healthcheck
#     node -e are known-legitimate here and are deliberately not matched.)
# ---------------------------------------------------------------------------
OBF_PATTERNS=(
  'eval\s*\(\s*atob'
  'atob\s*\([^)]*\)[^;\n]{0,120}eval\s*\('
  '_0x[0-9a-fA-F]{4,}'
  'String\.fromCharCode\(([0-9]{1,3},){20,}'
)
HITS=$(content_grep -nomd "${OBF_PATTERNS[@]}")
if [[ -n "$HITS" ]]; then
  fail "Obfuscated payload pattern found (decoded-eval / hex identifier obfuscation)"
  echo "$HITS" | head -40
fi

HITS=$(content_grep -nomd -e 'Function\s*\(\s*["'"'"']return')
if [[ -n "$HITS" ]]; then
  warn "Function(\"return …\") constructor use — verify not an obfuscation wrapper"
  echo "$HITS" | head -20
fi

# Credential theft: private keys, SSH/AWS credential paths, npm auth tokens.
CRED_PATTERNS=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'id_rsa\b|id_ed25519\b'
  '\.aws/credentials'
  '_authToken\s*='
  'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}'
)
HITS=$(content_grep "${CRED_PATTERNS[@]}")
if [[ -n "$HITS" ]]; then
  fail "Credential-theft / hardcoded-secret pattern found"
  echo "$HITS" | head -40
fi

# Suspicious network: known exfiltration endpoints fail; tunneling services warn.
HITS=$(content_grep -nomd -e 'webhook\.site' -e 'pastebin\.com/raw' -e 'requestbin\.?')
if [[ -n "$HITS" ]]; then
  fail "Known data-exfiltration endpoint referenced"
  echo "$HITS" | head -20
fi
HITS=$(content_grep -nomd -e 'ngrok\.io/|trycloudflare\.com')
if [[ -n "$HITS" ]]; then
  warn "Tunneling service referenced — verify this is legitimate dev usage"
  echo "$HITS" | head -20
fi

# curl|wget piped to a shell anywhere outside documentation (docs/guides
# legitimately show `curl … | sh` install lines; *.md/*.txt are skipped).
HITS=$(content_grep -nomd -e '(curl|wget)[^|;\n]{0,200}\|\s*(ba|z|da)?sh\b')
if [[ -n "$HITS" ]]; then
  fail "curl/wget piped to a shell found outside documentation (remote code execution pattern)"
  echo "$HITS" | head -30
fi

# Raw public-IP URL (loopback/private ranges filtered out).
HITS=$(content_grep -nomd -e 'https?://([0-9]{1,3}\.){3}[0-9]{1,3}' \
  | grep -vE 'https?://(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|255\.)' || true)
if [[ -n "$HITS" ]]; then
  warn "URL with raw public IP address — verify destination is expected"
  echo "$HITS" | head -20
fi

# Unexpected execution: child_process exec is legitimate in some tooling, so
# warn by default and fail only when paired with a download/pipe on the line.
CP_HITS=$(content_grep -nomd -e 'child_process["'"'"']?\]?\s*\.\s*exec(Sync)?\s*\(')
if [[ -n "$CP_HITS" ]]; then
  dangerous=$(printf '%s\n' "$CP_HITS" | grep -E 'curl|wget|\|\s*(ba)?sh|https?://' || true)
  if [[ -n "$dangerous" ]]; then
    fail "child_process exec combined with network/download on the same line"
    echo "$dangerous" | head -20
  else
    warn "child_process.exec usage — verify it is intentional tooling, not a dropper"
    echo "$CP_HITS" | head -20
  fi
fi

# Tracked .env files that are not examples indicate committed secrets.
scan_files | grep -zE '(^|/)\.env$' > /tmp/polintrider_env.$$ || true
if [[ -s /tmp/polintrider_env.$$ ]]; then
  while IFS= read -r -d '' f; do
    fail "Tracked environment file (likely contains secrets): $f"
  done < /tmp/polintrider_env.$$
fi
rm -f /tmp/polintrider_env.$$

# ---------------------------------------------------------------------------
# 10) PR changed-files mode — high-risk paths fail closed on PRs
# ---------------------------------------------------------------------------
if [[ "$MODE" == "pr-files" && -n "${POLIN_CHANGED_FILES:-}" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    # Path rules apply even if the file was renamed/removed mid-PR (fail closed).
    case "$f" in
      .vscode/tasks.json|*/.vscode/tasks.json|dist/setup.js|*/dist/setup.js|temp_auto_push.bat|temp_interactive_push.bat)
        fail "PR introduces/modifies high-risk malware path: $f"
        ;;
      .env|*/.env)
        fail "PR introduces/tracks an environment file: $f"
        ;;
      security/fixtures/*|scripts/security/*|docs/SECURITY_POLINRIDER.md|.github/workflows/polinrider-security.yml)
        warn "PR touches security scanner files ($f) — verify detection is not being weakened"
        ;;
      *.bat|*.cmd)
        warn "PR adds a Windows batch file: $f — verify legitimacy"
        ;;
    esac
    # Content rules need the file present in the checkout.
    [[ -f "$f" ]] || continue
    if [[ "$f" != scripts/security/* && "$f" != security/fixtures/* && \
          "$f" != docs/SECURITY_POLINRIDER.md && \
          "$f" != .github/workflows/polinrider-security.yml ]]; then
      if grep -qaIiE "$(IFS='|'; echo "${MARKER_PATTERNS[*]}")" "$f" 2>/dev/null; then
        fail "PolinRider marker in changed file: $f"
      fi
    fi
  done <<< "$POLIN_CHANGED_FILES"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "### Summary"
if [[ ${#REPORT[@]} -eq 0 ]]; then
  echo "No findings recorded."
else
  printf '%s\n' "${REPORT[@]}"
fi
echo

if [[ "$FAIL" -ne 0 ]]; then
  echo "MALWARE INDICATORS DETECTED — Do not merge. Review the findings above with context."
  echo "::error::MALWARE INDICATORS DETECTED — Do not merge. Review the security report and remove the malicious code."
  exit 1
fi

if [[ "$WARN" -ne 0 ]]; then
  echo "Scan completed with items needing human review (see warnings). No confirmed indicators."
  exit 0
fi

echo "Scan clean: no PolinRider indicators found."
exit 0
