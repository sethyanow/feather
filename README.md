# feather

Feather provides prose review that constrains and guides agents
writing a large share of comments, docs, and commits.

It catches a small set of generated-text habits that repeatedly waste review
time: padded paragraphs, shouting, stale line citations, vague importance
claims, diff narration, and AI attribution.

I got tired of Claude calling things load bearing so I had it write rules that
would catch that. That way, agents are forced to say what they mean and not
lean on the fuzzy semantics of prose.

Feather is a stripped down extraction from my personal tooling. Fork it, hack
it, share it. Keep your agents from propagating semantic diffusion.

## Install

### Install Script

1. Run the setup script:

```sh
curl -fsSL https://raw.githubusercontent.com/sethyanow/feather/main/install.sh | sh
```

The script checks for `ast-grep`, `lefthook`, and Node 22+ and prints the
install command for anything missing. It installs nothing itself. Then it asks
what you want: markdown or comment rules (or both), the comment source language
(default `typescript`), pre-commit or commit-msg hooks (or both), and whether to
run `lefthook install`.

An existing `sgconfig.yml` or `lefthook.yml` gets backed up to
`<file>.feather.bak.<timestamp>`, then merged, replaced, or skipped per your
choice. The `lefthook.yml` merge needs `yq`. Without it the script drops
`lefthook.feather.yml` next to your file and tells you how to finish by hand.

Every prompt takes a `FEATHER_*` override, and `FEATHER_YES=1` accepts the
defaults. Full list in the script header.

### Manual

1. Install `ast-grep`, `lefthook`, and Node 22+.
2. Run `ast-grep scan` to audit your tree.
3. Run `lefthook install` to wire pre-commit and commit-msg hooks.

The markdown rules work as-is. For comments, edit the `language` field in
`rules/comments.yml` to match your source language, then run the install
sequence again.

## How It Works

- **Prose rules** (`rules/*.yml`) run on staged files at pre-commit. Most are
  `hint`/`warning` — they print findings but exit 0, so they never block, the
  floor for new writing while you clean a backlog. The `*-load-bearing` rules
  ship at `error`: a match blocks the commit. Promote any other rule the same
  way once its violations are gone.
- **The commit-msg validator** (`scripts/check-commit-msg.mjs`) gates messages.
  Conventional Commits shape, length, no AI attribution, no diff-restating
  narration. A bad message exits 1 before the commit lands — just re-run with a
  corrected one.

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
- Node 22+ (the checker is pure `node:fs`)

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
CLAUDE.md                       map for agents working on feather itself
```

## Adapt it

[docs/adapting.md](docs/adapting.md) is a step-by-step checklist written to be
followed by a person or handed to an agent: install the tools, copy the files,
set globs and the comment language, tune the opinionated bits, install the
hooks, and verify.
[docs/documentation-standards.md](docs/documentation-standards.md) is the
human-readable spec the rules enforce — copy it as your team's starting point
and edit the wording.

## License

MIT — see [LICENSE](LICENSE) and <https://seth.mit-license.org/>.
