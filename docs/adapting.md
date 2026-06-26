# Adapting feather to your repo

A checklist for wiring feather's prose-hygiene rules and commit-msg gate into a
project. Written to be followed by a person or by an agent — each step is a
concrete edit or command. Work top to bottom.

## What you are installing

Two enforcement tiers:

1. **Prose rules** (`rules/*.yml`) run on staged files at pre-commit in hint
   mode. They print findings but never block a commit (ast-grep `hint` and
   `warning` severities exit 0). This is the floor for new writing while you
   clean a backlog.
2. **The commit-msg validator** (`scripts/check-commit-msg.mjs`) is the only
   hard gate. It exits 1 on a bad message, blocking the commit.

## 1. Install the tools

Three binaries, none of them an npm dependency of your project:

- [ast-grep](https://ast-grep.github.io) — runs the rules.
- [lefthook](https://lefthook.dev) — wires the git hooks.
- Node 18+ — runs the commit-msg checker (pure `node:fs`, no packages).

```sh
ast-grep --version
lefthook --version
node --version
```

## 2. Copy the files in

Copy these into the root of your repo, preserving paths:

```
sgconfig.yml
lefthook.yml
rules/                       # all 9 *.yml
scripts/check-commit-msg.mjs
docs/documentation-standards.md   # optional: your team's written spec
```

If your repo already has an `sgconfig.yml`, merge `rules` into its `ruleDirs`
rather than overwriting.

## 3. Set the comment language

The four `comment-*.yml` rules scan code comments and ship with
`language: typescript`. Change that one field to your source language in each:

```sh
# example: a Python project
sed -i '' 's/^language: typescript/language: python/' rules/comment-*.yml
```

ast-grep's built-in languages include `python`, `rust`, `go`, `java`, `c`,
`cpp`, `javascript`, `tsx`, and more. The five `md-*.yml` rules are markdown and
need no change. To cover several languages at once, duplicate a `comment-*.yml`
with a new `id` and a different `language`.

## 4. Point the hook at your files

In `lefthook.yml`, set the pre-commit `glob` to your source and doc extensions:

```yaml
glob: "*.{py,md}"        # was *.{ts,tsx,js,md}
```

Confirm the commit-msg `run` path matches where you put the checker
(`node scripts/check-commit-msg.mjs {1}` by default).

## 5. Tune the opinions

These defaults are feather's stance; change them to yours.

- **`scripts/check-commit-msg.mjs`** — the `TYPES` list (allowed commit types),
  and three hard-fail bans you may not want: the structural-importance phrase
  ban (the tic `md-load-bearing` also catches), the `this commit` ban, and the
  `as requested by` ban. Delete a `fails.push(...)` block to drop a ban, or
  move it to `warns.push(...)` to soften it.
- **Caps-theater word lists** — `comment-caps-theater.yml` and
  `md-caps-theater.yml` carry curated word lists. They are deliberately short to
  keep false positives near zero. Add or remove words to taste.

## 6. Install the hooks

```sh
lefthook install
```

This writes `.git/hooks/pre-commit` and `.git/hooks/commit-msg`. Re-run it
after any edit to `lefthook.yml`.

## 7. Verify

Run the rules over your tree and push a bad message through the checker:

```sh
ast-grep scan                                    # all rules, no error exit
printf 'Added stuff.\n' | (cat > /tmp/m && node scripts/check-commit-msg.mjs /tmp/m); echo "exit $?"
```

The checker should reject that subject (wrong shape, trailing period,
non-imperative) and exit 1. A well-formed `feat(scope): add the thing` exits 0.

## 8. Escalate a rule when ready

Every prose rule ships as a hint so it never blocks. Once a rule's violations
are cleared from your tree, enforce it by adding `--error` to its scan — for
example a dedicated job that fails the commit:

```yaml
- name: prose-enforced
  glob: "*.md"
  run: ast-grep scan --rule rules/md-load-bearing.yml --error {staged_files}
```

Keep the rest in the hint job. Promote rules one at a time as the tree gets
clean, so the gate tightens without a flag day.
