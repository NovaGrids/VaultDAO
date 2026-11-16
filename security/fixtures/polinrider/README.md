# PolinRider security fixtures

**These files are intentional, inert test fixtures for the repository malware
scanner (`scripts/security/scan-polinrider.sh`). They are NOT malicious code
and are never executed by CI or by the scanner.**

Fixtures are excluded from normal repository scans (`security/fixtures/` is on
the scanner's exclusion list). The scanner's `self-test` mode copies them into
a temporary directory outside the repo and asserts that each one is detected:

| File | Simulates | Expected detection |
| --- | --- | --- |
| `clean-sample.js` | Ordinary project code | **Not** detected (negative control) |
| `fa-solid-400.woff2` | Fake-font payload (JS/text with PolinRider markers disguised as a font) | Rule 5: font-named file is text/JS + Rule 1: markers |
| `tasks.json` | VS Code `folderOpen` task running `node` on a non-JS asset (classic trigger) | Rule 2: folderOpen + non-JS node target |
| `gitignore.snippet` | `.gitignore` fingerprint entries used by the campaign | Rule 3: fingerprint |
| `tailwind.config.js` | Inline config-injection variant (payload appended on an extreme-length line) | Rule 8: extreme line length with markers |
| `lifecycle-package.json` | npm `postinstall` script downloading and piping to a shell | Rule 7: suspicious lifecycle script |
| `obfuscated.js` | `eval(atob(...))` decoded-eval payload | Rule 9: obfuscation pattern |
| `credential-theft.js` | Attempts to read SSH/private-key material | Rule 9: credential-theft pattern |

Fixture strings (`rmcej%otb%`, `_$_1e42`, etc.) are published IoC markers from
public PolinRider analyses. They are inert data — no code in this directory is
ever run.

## Running the self-test

```bash
./scripts/security/scan-polinrider.sh . self-test
```

Expected: exit `0` with `SELF-TEST PASS (negative)` and
`SELF-TEST PASS (positive)` lines. A non-zero exit means detection broke.

## Editing fixtures

- Do not remove markers from fixtures to make a scan pass — that weakens the
  test, and the scanner intentionally ignores this directory.
- Do not move fixtures outside `security/fixtures/polinrider/` without also
  updating the scanner's exclusion list and self-test paths.
