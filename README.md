# feather

A light-touch prose-hygiene gate for code comments, docs, and commit messages.
Structural `ast-grep` rules plus a commit-msg validator, wired through
`lefthook`. The rules nudge in hint mode; the commit gate is the only hard wall.

The name is the design: feather sits on top of your writing without weighing it
down. (It also ships `md-load-bearing` and `comment-load-bearing` — rules that
ban a structural-importance tic, so feather forbids the very word it embodies.)

## The two tiers

- **Prose rules** (`rules/*.yml`) run on staged files at pre-commit in hint
  mode. They print findings but never block a commit — `hint` and `warning`
  severities exit 0. This is the floor for new writing while you clean a
  backlog. Promote a rule to blocking with `--error` once its violations are
  gone.
- **The commit-msg validator** (`scripts/check-commit-msg.mjs`) is the only hard
  gate. Conventional Commits shape, length, no AI attribution, no diff-restating
  narration. A bad message exits 1 and is regenerated, not amended.

## What the rules catch

| Rule | Surface | Catches |
| --- | --- | --- |
| `md-paragraph-line-over-80` | markdown | prose lines past 80 chars |
| `md-heading-over-50` | markdown | headings carrying a sentence |
| `md-paragraph-wall` | markdown | paragraphs over ~700 chars |
| `md-caps-theater` | markdown | all-caps words used to shout |
| `md-load-bearing` | markdown | the "load-bearing" tic |
| `comment-caps-theater` | comments | all-caps emphasis |
| `comment-narrative-wall` | comments | 9+ line block comments |
| `comment-source-line-cite` | comments | `:NNN` line citations that rot |
| `comment-load-bearing` | comments | the "load-bearing" tic |

The wall and caps rules measure content, not wrapping, so reflowing a long line
into many short ones does not hide the problem.

## Install

Three binaries, none an npm dependency of your project:

- [ast-grep](https://ast-grep.github.io)
- [lefthook](https://lefthook.dev)
- Node 18+ (the checker is pure `node:fs`)

Then, from your repo root:

```sh
ast-grep scan          # run every rule over the tree
lefthook install       # wire pre-commit + commit-msg into .git/hooks
```

The markdown rules work as-is. The comment rules ship as `language: typescript`
— change that field to your source language. Full steps:
[docs/adapting.md](docs/adapting.md).

## Layout

```
sgconfig.yml                    ast-grep config (ruleDirs: rules)
lefthook.yml                    pre-commit hints + commit-msg gate
rules/                          5 markdown + 4 comment rules
scripts/check-commit-msg.mjs    the commit-msg validator
docs/documentation-standards.md the written spec the rules encode
docs/adapting.md                adoption checklist (human or agent)
```

## Adapt it

[docs/adapting.md](docs/adapting.md) is a step-by-step checklist written to be
followed by a person or handed to an agent: install the tools, copy the files,
set globs and the comment language, tune the opinionated bits, install the
hooks, and verify.
[docs/documentation-standards.md](docs/documentation-standards.md) is the
human-readable spec the rules enforce — copy it as your team's starting point
and edit the wording.
