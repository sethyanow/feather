# CLAUDE.md

Feather is a prose-hygiene gate: ast-grep rules over comments and docs, plus a
commit-msg validator, wired through lefthook. README.md is the overview;
docs/adapting.md is the adoption checklist. This file is the map for working on
feather itself.

## Where things live

- `rules/*.yml` — the checks. `md-*` scan markdown, `comment-*` scan code
  comments. Each rule's own `note:` explains its regex and edge cases.
- `scripts/check-commit-msg.mjs` — the commit-msg validator. Pure node, no deps.
- `sgconfig.yml` — points ast-grep at `rules/`.
- `lefthook.yml` — pre-commit (prose hints) and commit-msg (the gate).

## The one thing to internalize

Two tiers, and only one blocks. Prose rules run as `hint`/`warning`, which
ast-grep exits 0 on — `ast-grep scan` never fails on its own. The commit-msg
validator is the only hard gate (exit 1). Promote a prose rule to blocking with
`--error` on its scan.

## Working on it

- Iterate on a rule: `ast-grep scan --rule rules/<id>.yml <file>`. ast-grep's
  playground and docs cover pattern syntax.
- `comment-*` rules are `language: typescript` by default; set `language` when
  adding one for another source language.
- Markdown rules read prose only — tables, fenced code, and headings are other
  node kinds, so a rule that won't fire there is working as intended.
- Run the validator directly: `node scripts/check-commit-msg.mjs <msgfile>`. Its
  `TYPES` list and the warning/fail split are the tunables.
- After editing `lefthook.yml`, run `lefthook install` to re-sync the hooks.
