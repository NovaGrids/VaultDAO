# PolinRider malware protection

This repository includes a **read-only** scanner for indicators associated
with the **PolinRider** (Contagious Interview / DPRK-linked) supply-chain
campaign: fake-font payloads, VS Code `folderOpen` auto-tasks, obfuscated
loaders, credential theft, suspicious lifecycle scripts, and exfiltration
endpoints.

- Scanner: `scripts/security/scan-polinrider.sh`
- Fixtures: `security/fixtures/polinrider/` (inert, documented, excluded from
  normal scans — see the README there)
- CI workflow: `.github/workflows/polinrider-security.yml`
- Required-check name: **`PolinRider Security Scan`**

## What it detects

**Confirmed findings (scan exits 1, blocks merge when required):**

| # | Rule | What it catches |
| --- | --- | --- |
| 1 | IoC markers | Known PolinRider strings (`rmcej%otb%`, `$_1e42`, `global['!']`, `global["_V"]`, `global.i="A…`, `temp_auto_push.bat`, `temp_interactive_push.bat`, `DEV#POPPER`, `OmniSteal`) anywhere in tracked content, including binaries |
| 2 | VS Code auto-run | `.vscode/tasks.json` (any directory) with `runOn: folderOpen` executing `node` on a non-JS asset (the classic trigger) |
| 3 | `.gitignore` fingerprint | Entries for `temp_auto_push` / `temp_interactive_push` in any `.gitignore` |
| 4 | Batch helpers | Presence of `temp_auto_push.bat` / `temp_interactive_push.bat` anywhere in the tree |
| 5 | Fake fonts | A font-named file (`.woff/woff2/ttf/otf/eot`) whose content is text/JavaScript — with extra context if it carries IoC markers |
| 6 | Drop paths | Unexpected `dist/setup.js` |
| 7 | Lifecycle scripts | `package.json` (all four manifests: root, backend, frontend, sdk) `pre/postinstall`/`prepare`/`publish` scripts that curl/wget-pipe to a shell, use `node -e`, `eval`, `child_process`, or encoded PowerShell |
| 8 | Config injection | Build configs (`*.config.js/ts`, tailwind, vite, eslint, vitest, playwright, …) with extreme line length (>2000 chars) **plus** obfuscation markers; length alone is a warning |
| 9 | Obfuscation | `eval(atob(…))`, `atob(…)+eval`, `_0x…` hex identifiers, long `String.fromCharCode` chains |
| 9 | Credential theft | Private-key blocks, `id_rsa`/`id_ed25519` paths, `.aws/credentials`, npm `_authToken`, real-looking GitHub/npm/AWS token shapes |
| 9 | Exfiltration endpoints | `webhook.site`, `pastebin.com/raw`, `requestbin` |
| 9 | Remote execution | `curl`/`wget` piped to a shell outside documentation |
| 9 | Tracked secrets | A tracked `.env` file (not `.env.example`) |
| 9 | Execution+network | `child_process.exec…` on the same line as a download/pipe |
| PR | Changed files | Fail-closed path rules on PR diffs: high-risk malware paths (`.vscode/tasks.json`, `dist/setup.js`, `temp_*_push.bat`), tracked `.env`; marker content in any changed file |

**Warnings (scan stays green, human review required):**

- `folderOpen` tasks without a non-JS `node` target
- Decoy font filename references (`fa-solid-400.woff2`)
- Any other `.bat`/`.cmd` file in the tree
- Extreme config line length *without* markers
- `Function("return …")` constructor use
- Tunneling services (`ngrok.io`, `trycloudflare.com`)
- Raw public-IP URLs (loopback/private ranges excluded)
- `child_process.exec` without a network pairing
- PRs touching the scanner's own files (verify detection isn't weakened)

**Known false-positive risks handled during setup:** this repo legitimately
uses SQLite `db.exec`, Redis `eval()`, frontend `atob()` for display data, a
Docker healthcheck `node -e`, and a rustup `curl | sh` line in
`docs/guides/LOCAL_STACK.md`. Rules 7 and 9 are tuned so none of these match:
the lifecycle rule only inspects `package.json` lifecycle keys, and the broader
heuristics skip `*.md`/`*.txt` prose (credential/secret rules still scan them —
a token pasted in a README is a real leak).

## CI workflow

`.github/workflows/polinrider-security.yml` runs:

- every pull request (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- pushes to `main`
- manual `workflow_dispatch` (incident response: re-scan main on demand)

Safety properties:

- `actions/checkout` pinned by full commit SHA (`11d5960a…`, tag `v4`)
- top-level `permissions: contents: read` — no write scopes anywhere
- `persist-credentials: false` — the token is removed from the git config
  after checkout
- no dependency installation, no third-party scripts, no secrets referenced
- scanned files are never executed; fixtures are copied to a temp directory
  and read as text
- `timeout-minutes` set; concurrency cancels superseded PR runs

Jobs/steps in the run:

1. **Repository scan** — `pr-files` mode on PRs (also fail-closed changed-file
   rules), `repo` mode on push/dispatch.
2. **Fixture self-test** — proves on *every* run that the clean fixture scans
   clean (negative) and that all malicious-pattern fixtures are detected
   (positive). If anyone weakens a rule, this step fails.
3. **Git history advisory** — pickaxe over the last 500 commits, warnings only,
   never fails the run; scanner/docs/fixture paths excluded.

## Local usage

```bash
# Scan the working tree (tracked + untracked, gitignored state excluded)
./scripts/security/scan-polinrider.sh . repo

# PR-style scan with per-changed-file rules
POLIN_CHANGED_FILES=$'README.md\n.vscode/tasks.json' ./scripts/security/scan-polinrider.sh . pr-files

# Prove detection with inert fixtures (positive AND negative cases)
./scripts/security/scan-polinrider.sh . self-test
```

Exit codes: `0` clean (warnings allowed), `1` confirmed findings, `2` setup
error (e.g. missing fixtures).

**Expected results at time of writing:** `repo` mode exits 0 with "Scan clean";
`self-test` exits 0 after printing both `SELF-TEST PASS` lines. A `repo` exit 1
means real indicators — investigate before merging anything.

## Making the check required

The check reports under the job name **`PolinRider Security Scan`**.

> Status: see the final report / repository rules. Configure only after the
> workflow has run at least once on `main` so the check context actually
> exists (GitHub hides checks that never reported).

```bash
gh api repos/OWNER/VaultDAO/rulesets --method POST --input - <<'EOF'
{
  "name": "Require PolinRider Security Scan",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "PolinRider Security Scan" } ]
      }
    }
  ],
  "bypass_actors": []
}
EOF
```

Precedence note: this repository already has a ruleset (**"Main branch PR
enforcement"** — PR required, 1 approval, last-push approval, thread
resolution, squash/rebase only). That ruleset currently has
`enforcement: disabled`. Adding the PolinRider check must **not** remove or
weaken those rules; if/when the existing ruleset is enabled, keep both.

## Investigating a red run / false positives

1. Open the Actions log for **PolinRider Security Scan**.
2. Find the `CONFIRMED:` / `::error::` lines — each prints the matching
   file:line for context.
3. If a legitimate file matches by coincidence (e.g. a docs snippet), move or
   reword the content, or refine the rule in `scripts/security/scan-polinrider.sh`
   with a justification comment and keep the self-test green.
4. **Never** disable the required check or delete fixtures to make a run pass.

## Reporting

If you believe the scanner missed real malware in this repository, open a
private report via GitHub Security Advisories (`.github/SECURITY_ADVISORY_TEMPLATE.md`).
Do not commit malicious samples outside `security/fixtures/`.

## Limitations

- Static indicators only: packed/novel payloads with no known markers can
  evade it. Treat unexpected `folderOpen` tasks and text "fonts" as high signal.
- The history advisory is informational; attackers can rewrite history.
- The scanner does not rotate credentials or clean developer machines. If you
  opened an infected tree in VS Code with auto-tasks enabled, treat that
  machine as compromised: rotate GitHub/npm/cloud/SSH/wallet secrets from a
  clean device and review recent publishes and pushes.
