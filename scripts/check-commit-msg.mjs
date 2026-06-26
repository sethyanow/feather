#!/usr/bin/env node
// commit-msg validator — enforces the Conventional Commits convention.
//
// Hard-fails block the commit (exit 1); warnings print but allow it (exit 0).
// On any finding it points back at the fix and at the regenerate-don't-amend
// recovery, so a rejected commit gets a fresh message, not an amend.
//
// Pure Node, no npm dependencies. Argument: path to the commit message file
// (lefthook passes {1}). The TYPES list and the opinionated bans (load-bearing,
// "this commit", "as requested by") are the parts adopters tune — see
// docs/adapting.md.

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  process.stderr.write("check-commit-msg: no message file given\n");
  process.exit(2);
}

const raw = readFileSync(file, "utf8");

// Drop git's comment lines and everything below the verbose scissor.
const lines = [];
for (const line of raw.split("\n")) {
  if (/^# -{2,} >8 -{2,}/.test(line)) break;
  if (line.startsWith("#")) continue;
  lines.push(line);
}
const text = lines.join("\n");
const nonEmpty = lines.filter((l) => l.trim() !== "");
const subject = nonEmpty[0] ?? "";
const bodyPresent = nonEmpty.length > 1;

// Let git handle empty messages; skip machine-generated merge/revert/fixup.
if (!subject) process.exit(0);
if (/^(Merge |Revert "|fixup!|squash!|amend!)/.test(subject)) process.exit(0);

const TYPES = [
  "feat", "fix", "refactor", "perf", "docs",
  "test", "chore", "build", "ci", "style", "revert",
];

const fails = [];
const warns = [];

// Conventional Commits subject shape.
const fmt = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: .+`);
if (!fmt.test(subject)) {
  fails.push(`Subject must be "type(scope): summary"; type is one of ${TYPES.join(", ")}.`);
}

// Length: aim 50, hard cap 72.
const len = subject.length;
if (len > 72) fails.push(`Subject is ${len} chars; the hard cap is 72.`);
else if (len > 50) warns.push(`Subject is ${len} chars; aim for 50 or fewer.`);

// No trailing period.
if (/\.$/.test(subject)) fails.push("Subject must not end with a period.");

// No AI attribution anywhere.
if (/generated with|co-authored-by:\s*claude|\u{1F916}|claude code/iu.test(text)) {
  fails.push('Remove AI attribution (no "Generated with", Claude co-author, or robot emoji).');
}

// No emoji in the subject.
if (/\p{Extended_Pictographic}/u.test(subject)) {
  fails.push("No emoji in the subject.");
}

// "load-bearing" terminology is forbidden anywhere in the message.
if (/(?:^|[^\w-])load[\s_-]*bearing/i.test(text)) {
  fails.push('"load-bearing" terminology is forbidden — pick a different word.');
}

// dont-repeat-the-diff: the unambiguous narration tokens are hard-fails.
if (/\bthis commit\b/i.test(text)) {
  fails.push('Drop "this commit ..." — the diff says what; say why.');
}
if (/\bas requested by\b/i.test(text)) {
  fails.push('Drop "as requested by" — use a Co-authored-by trailer instead.');
}

// Breaking change or revert needs a body.
const breaking =
  /!:/.test(subject) || /\bBREAKING CHANGE\b/.test(text) || /^revert/i.test(subject);
if (breaking && !bodyPresent) {
  fails.push("A breaking change or revert needs a body explaining the why and the migration.");
}

// Softer signals are warnings — they can be legitimate, so they never block.
const summary = subject.replace(
  new RegExp(`^(${TYPES.join("|")})(\\([^)]*\\))?!?:\\s*`),
  "",
);
if (/\b(I|we|now|currently)\b/i.test(summary)) {
  warns.push('Subject narrates ("I/we/now/currently") — prefer imperative, why-over-what.');
}
if (/\b(MUST|NEVER|ALWAYS|NOT|ONLY|EXACTLY|SAME|EVERY|SINGLE|CANNOT)\b/.test(summary)) {
  warns.push("Caps-theater in subject — write plainly, no shouting for emphasis.");
}
const firstWord = summary.split(/\s+/)[0] ?? "";
if (/(ed|ing)$/i.test(firstWord) || /^(adds|fixes|removes|updates|changes)$/i.test(firstWord)) {
  warns.push(`"${firstWord}" looks non-imperative — use add/fix/remove, not added/adds/adding.`);
}

// Body lines should wrap at 72.
const longBody = lines.slice(1).filter((l) => !l.startsWith("    ") && l.length > 72);
if (longBody.length) {
  warns.push(`${longBody.length} body line(s) exceed 72 chars — wrap the body.`);
}

function pointer() {
  const w = (s) => process.stderr.write(s + "\n");
  w("");
  w("  Core hints: Conventional Commits, why-over-what, dont-repeat-the-diff.");
  w("  Do not `git commit --amend` — it rewrites the prior commit, and amending");
  w("  an already-pushed commit forces a push. Re-run `git commit` with a");
  w("  corrected message; if a bad message already landed, make an honest");
  w("  follow-up commit and push that.");
}

if (warns.length) {
  process.stderr.write("commit-style warnings:\n");
  for (const x of warns) process.stderr.write("  - " + x + "\n");
}
if (fails.length) {
  process.stderr.write("commit-style rejected this message:\n");
  for (const x of fails) process.stderr.write("  - " + x + "\n");
}
if (fails.length || warns.length) pointer();
process.exit(fails.length ? 1 : 0);
