# Documentation standards

How to write docs and code comments for two readers at once: a human who needs
to scan, and an agent who needs to parse without ambiguity. The rules below are
a floor for new writing. Most are enforced by runnable `ast-grep` rules in
[`rules/`](../rules); the rest are judgment.

This doc follows its own rules — use it as a worked example. Adapt the wording
to your project; the structure is the point.

## Principles

- **Front-load the actionable.** The decisive sentence comes first; context
  follows. A reader who stops after one line should still have the point.
- **Status is state, not prose.** A thing is `open`, `decided`, or `done` —
  say so in a field, not buried in a paragraph the reader has to mine.
- **One idea per paragraph.** Blank-line separated. When a paragraph braids
  decision, evidence, and aside together, split it.
- **Write plainly.** No all-caps emphasis; let structure and word choice carry
  the weight. Acronyms and code identifiers are exempt.

## Mechanical rules

Each rule below is a structural check you can run on demand
(`ast-grep scan --rule rules/<id>.yml <path>`) and that the pre-commit hook
prints as a hint on staged files. Markdown rules read prose only — tables,
fenced code, and headings are different node kinds, so they are exempt where
noted.

| Standard | Surface | Rule |
| --- | --- | --- |
| Prose lines wrap at 80; tables and code exempt | markdown | [md-paragraph-line-over-80](../rules/md-paragraph-line-over-80.yml) |
| Headings stay under 50 chars | markdown | [md-heading-over-50](../rules/md-heading-over-50.yml) |
| No walls — split paragraphs over ~700 chars | markdown | [md-paragraph-wall](../rules/md-paragraph-wall.yml) |
| No caps theater | markdown | [md-caps-theater](../rules/md-caps-theater.yml) |
| No "load-bearing" tic | markdown | [md-load-bearing](../rules/md-load-bearing.yml) |
| No caps theater | code comments | [comment-caps-theater](../rules/comment-caps-theater.yml) |
| No walls — keep comments tight | code comments | [comment-narrative-wall](../rules/comment-narrative-wall.yml) |
| Cite symbols, not `:NNN` line numbers | code comments | [comment-source-line-cite](../rules/comment-source-line-cite.yml) |
| No "load-bearing" tic | code comments | [comment-load-bearing](../rules/comment-load-bearing.yml) |

The wall rules measure content, not line count, so a wall reads the same whether
it ships as one long line or many wrapped ones.

## Citations and linking

Cite the thing, not its current position.

- **Cite symbols and sections, never line numbers.** A `:NNN` reference rots
  the moment the file shifts. Name the symbol (`parseHeader` in
  `src/parser.ts`), which survives edits and an LSP can resolve.
- **Use real CommonMark links in markdown.** A link is `[meaningful text](path)`
  or `[text](path#anchor)` — not a bare path, not "see here". The anchor and
  link text both name what they point at.
- **Anchor text names the target**, not "here" or "this section".

## Decision documents

A fix plan or decision log is semi-structured data, not an essay. Keep state,
evidence, and decision separable so nothing bleeds between them. Per item:

```markdown
### <short title>

**State:** open | decided | done

**Evidence.** What was observed and how (verified, read, measured), with links
to the symbols or sections involved.

**Decision.** The chosen path in one line. Each rejected alternative traces to a
decision, so the log records why, not just what.

**Open.** Remaining questions, if any.
```

A reader scanning only the **State** and **Decision** lines gets the whole plan.
The evidence is there for whoever needs to verify it, and out of the way of
whoever does not.

## Code comments

- Lead with what the thing is and why it exists, in one to three lines.
- Move long rationale into a doc the comment links, rather than growing a wall
  in the source.
- Cite collaborating code by symbol name, so navigation resolves and the
  reference does not rot.

## Commit messages

Conventional Commits, why over what, no diff-restating. The `commit-msg` hook
([`scripts/check-commit-msg.mjs`](../scripts/check-commit-msg.mjs)) enforces the
mechanical subset and rejects a bad message rather than letting it land.

## Enforcement

Hooks run via [`lefthook`](../lefthook.yml):

- **pre-commit** runs the prose rules on staged files. Most are hints — they
  print findings but do not block, the floor for new writing while a backlog is
  cleaned. `md-load-bearing` and `comment-load-bearing` ship at `error`, so they
  block the commit.
- **commit-msg** hard-enforces the commit convention.

To promote another prose rule to blocking once its violations are cleared, set
its `severity` to `error` (or add `--error` to that rule's scan). See
[adapting.md](adapting.md) for the full adoption checklist.
