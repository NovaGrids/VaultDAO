# Typedoc setup notes (for maintainers)

This file documents how SDK typedoc generation is expected to work.

- Add `typedoc` + `typedoc-plugin-markdown` as devDependencies (pinned)
- Add `sdk:docs` script to `sdk/package.json`
- Configure typedoc to output `sdk/docs/`
- Ensure `sdk/docs` is gitignored

This repository environment may not have `node_modules` installed; commands must be run after `npm/pnpm install`.
