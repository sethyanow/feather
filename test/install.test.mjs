// Tests for install.sh. Grown one slice at a time (red -> green).
//
// The harness lives in ./helpers.mjs: it spawns install.sh in a temp dir with
// a stubbed PATH and FEATHER_SRC pointed at the repo checkout, and drives all
// selection via FEATHER_* env vars.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  COMMITTED_LEFTHOOK,
  COMMENT_RULES,
  DEFAULT_STUBS,
  MD_RULES,
  hasYq,
  readdir,
  runInstall,
} from "./helpers.mjs";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("install harness", () => {
  it("can spawn install.sh", () => {
    const res = runInstall();
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
  });
});

describe("slice 2: comment-only selection + language rewrite", () => {
  it("copies the 4 comment-*.yml with language rewritten to FEATHER_LANG, omits markdown", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "comment",
        FEATHER_HOOKS: "",
        FEATHER_LANG: "python",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    for (const f of COMMENT_RULES) {
      const content = readFileSync(join(res.dir, "rules", f), "utf8");
      assert.match(content, /^language: python$/m, `${f} language not rewritten to python`);
    }
    for (const f of MD_RULES) {
      assert.ok(
        !existsSync(join(res.dir, "rules", f)),
        `markdown rule ${f} should not be copied for comment-only`,
      );
    }
  });

  it("defaults the comment language to typescript when FEATHER_LANG unset", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "comment",
        FEATHER_HOOKS: "",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const content = readFileSync(
      join(res.dir, "rules", "comment-caps-theater.yml"),
      "utf8",
    );
    assert.match(content, /^language: typescript$/m);
  });
});

describe("slice 3: hook selection", () => {
  it("assembles lefthook.yml with both jobs when both hooks chosen, and fetches the checker", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown,comment",
        FEATHER_HOOKS: "pre-commit,commit-msg",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(lh, /pre-commit:/);
    assert.match(lh, /name: prose/);
    assert.match(lh, /commit-msg:/);
    assert.match(lh, /name: commit-style/);
    assert.ok(
      existsSync(join(res.dir, "scripts", "check-commit-msg.mjs")),
      "checker should be fetched when commit-msg is chosen",
    );
  });

  it("assembles only the pre-commit job and skips the checker", () => {
    const res = runInstall({
      env: { FEATHER_RULES: "markdown", FEATHER_HOOKS: "pre-commit" },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(lh, /pre-commit:/);
    assert.doesNotMatch(lh, /commit-msg:/);
    assert.ok(
      !existsSync(join(res.dir, "scripts", "check-commit-msg.mjs")),
      "checker must not be fetched without the commit-msg hook",
    );
  });

  it("assembles only the commit-msg job and fetches the checker", () => {
    const res = runInstall({
      env: { FEATHER_RULES: "markdown", FEATHER_HOOKS: "commit-msg" },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.doesNotMatch(lh, /pre-commit:/);
    assert.match(lh, /commit-msg:/);
    assert.ok(
      existsSync(join(res.dir, "scripts", "check-commit-msg.mjs")),
    );
  });

  it("writes no lefthook.yml when no hooks chosen", () => {
    const res = runInstall({
      env: { FEATHER_RULES: "markdown", FEATHER_HOOKS: "" },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    assert.ok(!existsSync(join(res.dir, "lefthook.yml")));
  });

  it("defaults to both hooks when FEATHER_HOOKS is unset (FEATHER_YES)", () => {
    // The complement of the test above: an *unset* FEATHER_HOOKS must take the
    // default (both hooks), while a *set-but-empty* one means "none". The
    // resolver must tell those apart (${VAR+x}, not emptiness), or one of this
    // pair goes red.
    const res = runInstall({
      env: { FEATHER_RULES: "markdown" }, // FEATHER_HOOKS intentionally unset
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(lh, /pre-commit:/);
    assert.match(lh, /commit-msg:/);
  });
});

describe("slice 9: optional lefthook install", () => {
  it("runs lefthook install when FEATHER_RUN_INSTALL=1", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_RUN_INSTALL: "1",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    assert.ok(res.lefthookCalled, "lefthook install should have been invoked");
  });

  it("does not run lefthook install when FEATHER_RUN_INSTALL is unset", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    assert.ok(!res.lefthookCalled, "lefthook install should not run by default");
  });

  it("does not run lefthook install when no hooks were selected", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_RUN_INSTALL: "1",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    assert.ok(
      !res.lefthookCalled,
      "should not install hooks when none were selected",
    );
  });

  it("prints next-steps guidance on success", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const out = res.stdout + res.stderr;
    assert.match(out, /ast-grep scan/);
  });

  it("lefthookCalled reflects only the current run when dir is reused", () => {
    const dir = mkdtempSync(join(tmpdir(), "feather-install-"));
    const envWithInstall = {
      FEATHER_RUN_INSTALL: "1",
      FEATHER_RULES: "markdown",
      FEATHER_HOOKS: "pre-commit",
    };
    const envWithoutInstall = {
      FEATHER_RULES: "markdown",
      FEATHER_HOOKS: "pre-commit",
    };
    const r1 = runInstall({ dir, env: envWithInstall });
    assert.equal(r1.status, 0, `run 1 failed:\n${r1.stderr}`);
    assert.ok(r1.lefthookCalled, "run 1 should invoke lefthook install");

    const r2 = runInstall({ dir, env: envWithoutInstall });
    assert.equal(r2.status, 0, `run 2 failed:\n${r2.stderr}`);
    assert.ok(
      !r2.lefthookCalled,
      "run 2 must not inherit lefthookCalled from run 1",
    );
  });
});

describe("slice 8: lefthook merge fallback", () => {
  const oldLh =
    "# my project hooks\npre-commit:\n  jobs:\n    - name: lint\n      run: eslint .\n";

  it("writes lefthook.feather.yml and leaves the original untouched when yq is absent", () => {
    const stubsWithoutYq = { ...DEFAULT_STUBS };
    delete stubsWithoutYq.yq;
    const res = runInstall({
      stubs: stubsWithoutYq,
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "merge",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const original = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.equal(original, oldLh, "original lefthook.yml must be untouched");

    assert.ok(
      existsSync(join(res.dir, "lefthook.feather.yml")),
      "expected lefthook.feather.yml sidecar",
    );
    const sidecar = readFileSync(
      join(res.dir, "lefthook.feather.yml"),
      "utf8",
    );
    assert.match(sidecar, /name: prose/);

    assert.match(
      res.stdout + res.stderr,
      /lefthook\.feather\.yml/,
      "should mention the sidecar file",
    );
    assert.match(
      res.stdout + res.stderr,
      /yq/i,
      "should mention yq in the note",
    );
  });

  it("deep-merges feather jobs into lefthook.yml when yq is present", () => {
    // A yq stub that records it was called and emits a merged-looking file.
    // The test verifies install.sh's plumbing (calls yq, writes merged output,
    // no sidecar) — it does not validate the stub's merge fidelity, which is
    // yq's job in production.
    const yqMarker = "FEATHER_YQ_CALLED";
    const yqStub = `#!/bin/sh
touch "${yqMarker}"
cat "$3" "$4"`;
    const stubsWithYq = { ...DEFAULT_STUBS, yq: yqStub };
    const res = runInstall({
      stubs: stubsWithYq,
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "merge",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    assert.ok(
      existsSync(join(res.dir, yqMarker)),
      "yq should have been invoked",
    );
    const merged = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(merged, /pre-commit:/);
    assert.match(merged, /name: lint/, "existing job should survive the merge");
    assert.match(merged, /name: prose/, "feather job should be present");
    assert.ok(
      !existsSync(join(res.dir, "lefthook.feather.yml")),
      "sidecar should not exist when yq is present",
    );
  });

  it("falls back to the sidecar when yq exists but can't eval-all (incompatible variant)", () => {
    // A yq on PATH that answers `--version` (so `command -v yq` and any version
    // probe pass) but fails the actual merge — e.g. python-yq, a jq wrapper with
    // entirely different syntax. install.sh must catch the failure and write the
    // sidecar, not abort under `set -e`.
    const yqStub = `#!/bin/sh
if [ "$1" = "eval-all" ] || [ "$1" = "eval" ]; then exit 1; fi
echo "yq 3.4.3"`;
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, yq: yqStub },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "merge",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.equal(
      res.status,
      0,
      `install.sh must not abort when yq can't merge:\n${res.stderr}`,
    );

    const original = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.equal(original, oldLh, "original lefthook.yml must be untouched");

    assert.ok(
      existsSync(join(res.dir, "lefthook.feather.yml")),
      "expected lefthook.feather.yml sidecar after yq merge failure",
    );
    assert.match(
      readFileSync(join(res.dir, "lefthook.feather.yml"), "utf8"),
      /name: prose/,
    );
    assert.match(
      res.stdout + res.stderr,
      /lefthook\.feather\.yml/,
      "should mention the sidecar file",
    );
    assert.match(res.stdout + res.stderr, /yq/i, "should mention yq in the note");
  });

  it("leaves no temp or partial merge file behind when yq fails mid-merge", () => {
    const yqStub = `#!/bin/sh
if [ "$1" = "eval-all" ] || [ "$1" = "eval" ]; then exit 1; fi
echo "yq 3.4.3"`;
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, yq: yqStub },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "merge",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const leftovers = readdir(res.dir).filter((f) =>
      f.startsWith(".feather-lh."),
    );
    assert.deepEqual(leftovers, [], `stray temp file(s): ${leftovers}`);
    assert.ok(
      !existsSync(join(res.dir, "lefthook.yml.merged")),
      "partial lefthook.yml.merged must be cleaned up",
    );
  });
});

describe("slice 7: sgconfig replace / skip / merge", () => {
  it("replace overwrites with feather's ruleDirs", () => {
    const oldSg = "ruleDirs:\n  - my-old-rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "replace",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    assert.doesNotMatch(sg, /my-old-rules/);
    assert.match(sg, /^  - rules$/m);
  });

  it("skip leaves the existing file byte-identical", () => {
    const oldSg = "ruleDirs:\n  - my-old-rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "skip",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    assert.equal(sg, oldSg);
  });

  it("merge appends '  - rules' under an existing ruleDirs: that lacks it", () => {
    const oldSg = "ruleDirs:\n  - my-own-rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "merge",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    assert.match(sg, /my-own-rules/);
    assert.match(sg, /^  - rules$/m);
  });

  it("merge is a no-op when ruleDirs already lists rules", () => {
    const oldSg = "ruleDirs:\n  - rules\n  - my-own-rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "merge",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    const ruleEntries = sg
      .split("\n")
      .filter((l) => /^\s+- rules\s*$/.test(l));
    assert.equal(ruleEntries.length, 1, "should not duplicate the rules entry");
  });
});

describe("slice 6: backup existing configs", () => {
  it("backs up a pre-existing sgconfig.yml before overwriting", () => {
    const oldSg = "ruleDirs:\n  - my-old-rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "replace",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const backups = readdir(join(res.dir)).filter((f) =>
      f.startsWith("sgconfig.yml.feather.bak."),
    );
    assert.equal(backups.length, 1, `expected one sgconfig backup, got ${backups.length}`);
    const bak = readFileSync(join(res.dir, backups[0]), "utf8");
    assert.equal(bak, oldSg, "backup should hold the original content");
  });

  it("backs up a pre-existing lefthook.yml before overwriting", () => {
    const oldLh = "pre-commit:\n  jobs: []\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "replace",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const backups = readdir(join(res.dir)).filter((f) =>
      f.startsWith("lefthook.yml.feather.bak."),
    );
    assert.equal(backups.length, 1);
    const bak = readFileSync(join(res.dir, backups[0]), "utf8");
    assert.equal(bak, oldLh);
  });

  it("does not back up configs that do not exist", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "replace",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const backups = readdir(join(res.dir)).filter((f) =>
      f.includes(".feather.bak."),
    );
    assert.equal(backups.length, 0, `no backups expected, got ${backups}`);
  });
});

describe("slice 5: instruct-only dependency detection", () => {
  it("prints install commands for missing ast-grep and aborts when not allowed to continue", () => {
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, "ast-grep": "exit 127" },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_DEPS_CONTINUE: "0",
      },
    });
    assert.notEqual(res.status, 0, "should abort when a dep is missing and continue is not granted");
    assert.match(res.stdout + res.stderr, /ast-grep/);
    assert.match(res.stdout + res.stderr, /brew install|cargo install|npm/i);
    // Must not have installed anything.
    assert.ok(!res.lefthookCalled);
  });

  it("aborts on old node (<22) under commit-msg with a node 22+ hint", () => {
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, node: 'echo "v20.0.0"' },
      env: {
        FEATHER_RULES: "markdown",
        // node is only required by the commit-msg checker, so the hook must be
        // selected for the version floor to be enforced.
        FEATHER_HOOKS: "commit-msg",
        FEATHER_DEPS_CONTINUE: "0",
      },
    });
    assert.notEqual(res.status, 0);
    const out = res.stdout + res.stderr;
    // The hint emitted by install.sh is the literal:
    //   "node 22+:  use nvm/brew install node, or see https://nodejs.org/"
    assert.match(out, /node 22\+/);
    assert.match(out, /nvm|nodejs\.org|brew/i);
  });

  it("does not require lefthook or node when no hooks are selected", () => {
    // Only markdown rules, no hooks: ast-grep is needed to scan, but lefthook
    // and node are not. Missing them must not abort (DEPS_CONTINUE=0 would
    // surface any spurious requirement as a non-zero exit).
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, lefthook: "exit 127", node: "exit 127" },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_DEPS_CONTINUE: "0",
      },
    });
    assert.equal(
      res.status,
      0,
      `markdown-only/no-hooks must not require lefthook or node:\n${res.stderr}`,
    );
  });

  it("requires lefthook when the pre-commit hook is selected", () => {
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, lefthook: "exit 127" },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_DEPS_CONTINUE: "0",
      },
    });
    assert.notEqual(res.status, 0, "the pre-commit hook needs lefthook");
    assert.match(res.stdout + res.stderr, /lefthook/);
  });

  it("does not require node for the pre-commit hook (node is commit-msg only)", () => {
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, node: "exit 127" },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_DEPS_CONTINUE: "0",
      },
    });
    assert.equal(
      res.status,
      0,
      `pre-commit alone must not require node:\n${res.stderr}`,
    );
  });

  it("continues past missing deps when FEATHER_DEPS_CONTINUE=1 and never auto-installs", () => {
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, "ast-grep": "exit 127" },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_DEPS_CONTINUE: "1",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    // Still printed the instruction.
    assert.match(res.stdout + res.stderr, /ast-grep/);
    // Did not try to run lefthook install (not requested).
    assert.ok(!res.lefthookCalled);
  });
});

describe("slice 4: lefthook.yml drift guard", () => {
  it("assembled output (all groups + both hooks) byte-equals the committed lefthook.yml", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown,comment",
        FEATHER_HOOKS: "pre-commit,commit-msg",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const generated = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.equal(
      generated,
      COMMITTED_LEFTHOOK,
      `Generated lefthook.yml drifted from the committed file.\n` +
        `--- generated ---\n${generated}\n--- committed ---\n${COMMITTED_LEFTHOOK}`,
    );
  });
});

describe("slice 1: markdown-only selection", () => {
  it("copies the 5 md-*.yml into rules/ and writes sgconfig.yml, omits comment rules + checker", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    for (const f of MD_RULES) {
      assert.ok(
        existsSync(join(res.dir, "rules", f)),
        `expected rules/${f} to be copied`,
      );
    }
    for (const f of COMMENT_RULES) {
      assert.ok(
        !existsSync(join(res.dir, "rules", f)),
        `comment rule ${f} should not be copied for markdown-only`,
      );
    }
    assert.ok(
      !existsSync(join(res.dir, "scripts", "check-commit-msg.mjs")),
      "checker should not be fetched without the commit-msg hook",
    );

    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    assert.match(sg, /ruleDirs:/);
    assert.match(sg, /- rules/);
  });
});

describe("FEATHER_LANG injection guard", () => {
  // Regression: ${FEATHER_LANG} is interpolated into a sed program at line 88
  // of install.sh. POSIX shells do not re-evaluate expanded values for command
  // substitution, so backticks/$(...) are inert; but the value still becomes
  // part of the sed program. A `/` breaks the s///, and on GNU sed (Linux)
  // `x/;e <cmd>` injects sed's `e` command -> arbitrary RCE. The fix rejects
  // any value that isn't a plain identifier (letters, digits, `_`, `-`).
  it("aborts on a sed-injection attempt and executes nothing", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "comment",
        FEATHER_HOOKS: "",
        FEATHER_LANG: "ts/;e echo PWNED",
      },
    });
    assert.notEqual(
      res.status,
      0,
      "malicious FEATHER_LANG must abort, not succeed",
    );
    const out = res.stdout + res.stderr;
    assert.match(out, /FEATHER_LANG/i);
    // No rule file should have been written (the abort happens before fetch).
    for (const f of COMMENT_RULES) {
      assert.ok(
        !existsSync(join(res.dir, "rules", f)),
        `${f} must not be written when FEATHER_LANG is rejected`,
      );
    }
  });

  it("rejects a value containing a slash", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "comment",
        FEATHER_HOOKS: "",
        FEATHER_LANG: "a/b",
      },
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /FEATHER_LANG/i);
  });
});

describe("F5: has() tolerates spaces in comma lists", () => {
  // Regression: has() did exact comma matching with no whitespace
  // normalization, so "markdown, comment" failed to match "comment".
  it("selects both groups when FEATHER_RULES has spaces after commas", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown, comment",
        FEATHER_HOOKS: "",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    for (const f of MD_RULES) {
      assert.ok(
        existsSync(join(res.dir, "rules", f)),
        `markdown rule ${f} should be copied when listed with spaces`,
      );
    }
    for (const f of COMMENT_RULES) {
      assert.ok(
        existsSync(join(res.dir, "rules", f)),
        `comment rule ${f} should be copied when listed with spaces`,
      );
    }
  });

  it("selects both hooks when FEATHER_HOOKS has spaces after commas", () => {
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit, commit-msg",
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(lh, /pre-commit:/);
    assert.match(lh, /commit-msg:/);
  });
});

describe("F6: commit-msg checker respects skip policy", () => {
  // Regression: the checker fetch lived inside lefthook.yml assembly, so it
  // ran even when an existing lefthook.yml was present with
  // FEATHER_LEFTHOOK=skip — silently overwriting a repo-local checker. The
  // fetch must follow the same skip decision as the rest of the hook content.
  it("does not fetch/overwrite scripts/check-commit-msg.mjs when FEATHER_LEFTHOOK=skip", () => {
    const existingChecker =
      "#!/usr/bin/env node\n// my project's own checker — do not touch\nconsole.log('mine');\n";
    const oldLh = "commit-msg:\n  jobs: []\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "commit-msg",
        FEATHER_LEFTHOOK: "skip",
      },
      seedFiles: {
        "lefthook.yml": oldLh,
        "scripts/check-commit-msg.mjs": existingChecker,
      },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    // Existing lefthook.yml left untouched.
    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.equal(lh, oldLh, "lefthook.yml must be untouched on skip");

    // Existing checker must be byte-identical.
    const checker = readFileSync(
      join(res.dir, "scripts", "check-commit-msg.mjs"),
      "utf8",
    );
    assert.equal(
      checker,
      existingChecker,
      "repo-local checker must not be overwritten on skip",
    );
  });
});

describe("F4: sgconfig merge handles inline ruleDirs: [..]", () => {
  // Regression: merge_sgconfig's awk path fired on any line starting with
  // `ruleDirs:`, including the inline form `ruleDirs: [team-rules]`. It then
  // appended a stray `  - rules` line, producing invalid YAML. The fix must
  // detect the inline-list form and inject `rules` into the brackets instead.
  it("injects rules into an inline ruleDirs: [team-rules] list", () => {
    const oldSg = "ruleDirs: [team-rules]\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "merge",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");

    // team-rules must survive.
    assert.match(sg, /team-rules/);
    // rules must be present somewhere.
    assert.match(sg, /rules/);

    // No stray block-list line: a line that is exactly `  - rules` is the
    // corruption signature from the old awk path.
    assert.doesNotMatch(
      sg,
      /^[[:space:]]+- rules[[:space:]]*$/m,
      "must not emit a stray `  - rules` block-list entry for inline form",
    );

    // Output must be valid YAML parseable by yq if available, and must
    // resolve ruleDirs to a list containing both entries.
    const yqOnPath =
      spawnSync("sh", ["-c", "command -v yq"], { encoding: "utf8" }).stdout.trim();
    if (yqOnPath) {
      const parsed = spawnSync("yq", ["-o=json", ".ruleDirs"], {
        input: sg,
        encoding: "utf8",
      });
      assert.equal(
        parsed.status,
        0,
        `yq could not parse merged sgconfig:\n${parsed.stderr}`,
      );
      const dirs = JSON.parse(parsed.stdout);
      assert.ok(
        Array.isArray(dirs) && dirs.includes("rules") && dirs.includes("team-rules"),
        `ruleDirs should be an array containing rules and team-rules; got ${JSON.stringify(dirs)}`,
      );
    }
  });

  it("is a no-op when inline ruleDirs already lists rules", () => {
    const oldSg = "ruleDirs: [rules, team-rules]\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "merge",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    // Parse the inline list and count exact `rules` entries; "team-rules"
    // must not be mistaken for "rules".
    const m = sg.match(/^ruleDirs:\s*\[(.*)\]/m);
    assert.ok(m, "expected an inline ruleDirs: [...] line");
    const entries = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const rulesEntries = entries.filter((e) => e === "rules");
    assert.equal(
      rulesEntries.length,
      1,
      `should have exactly one 'rules' entry; got ${JSON.stringify(entries)}`,
    );
    assert.ok(
      entries.includes("team-rules"),
      "team-rules must survive the no-op",
    );
  });
});

describe("F8: yq merge preserves existing jobs (array append)", () => {
  // Regression: merge_lefthook used yq's `*` operator, which REPLACES arrays.
  // An existing pre-commit.jobs: [lint] was clobbered by feather's [prose].
  // The fix uses `*+` so both jobs survive. The stub-yq test in slice 8 only
  // proves plumbing (calls yq, no sidecar) — this test exercises real yq's
  // actual array semantics.
  it("keeps both the existing lint job and feather's prose job under real yq", () => {
    if (!hasYq) {
      // Skip-style: still pass, just don't assert anything yq-specific.
      assert.ok(true, "yq not installed on this machine; skipping real-yq test");
      return;
    }
    const oldLh =
      "# my project hooks\npre-commit:\n  jobs:\n    - name: lint\n      run: eslint .\n";
    const res = runInstall({
      realYq: true,
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "merge",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const merged = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(merged, /name: lint/, "existing lint job must survive the merge");
    assert.match(merged, /name: prose/, "feather prose job must be present");
    assert.ok(
      !existsSync(join(res.dir, "lefthook.feather.yml")),
      "sidecar should not exist when yq is present",
    );

    // Cross-check with real yq: parse the merged file and assert the
    // pre-commit.jobs array literally contains both names. yq's -o=json
    // emits each scalar as a quoted JSON string, so unwrap quotes.
    const parsed = spawnSync(
      "yq",
      ["-o=json", ".pre-commit.jobs.[].name"],
      { input: merged, encoding: "utf8" },
    );
    assert.equal(parsed.status, 0, `yq failed to parse merged output:\n${parsed.stderr}`);
    const names = parsed.stdout
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^"(.*)"$/, "$1"));
    assert.deepEqual(
      names.sort(),
      ["lint", "prose"],
      `expected both lint and prose in pre-commit.jobs; got ${JSON.stringify(names)}`,
    );
  });

  it("is idempotent: re-merging does not duplicate jobs and adds no phantom hook", () => {
    if (!hasYq) {
      assert.ok(true, "yq not installed on this machine; skipping real-yq test");
      return;
    }
    // A lefthook.yml that already went through a feather merge: it carries the
    // user's lint job AND a feather prose job. Merging feather in again must
    // collapse the duplicate prose rather than append a second one.
    const preMerged =
      "# my project hooks\n" +
      "pre-commit:\n" +
      "  jobs:\n" +
      "    - name: lint\n" +
      "      run: eslint .\n" +
      "    - name: prose\n" +
      '      glob: "*.{ts,tsx,js,md}"\n' +
      "      run: ast-grep scan {staged_files}\n";
    const res = runInstall({
      realYq: true,
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "merge",
      },
      seedFiles: { "lefthook.yml": preMerged },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);

    const merged = readFileSync(join(res.dir, "lefthook.yml"), "utf8");

    // Exactly one lint and one prose — no duplicate.
    const parsed = spawnSync("yq", ["-o=json", ".pre-commit.jobs.[].name"], {
      input: merged,
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, `yq parse failed:\n${parsed.stderr}`);
    const names = parsed.stdout
      .trim()
      .split("\n")
      .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
    assert.deepEqual(
      names.sort(),
      ["lint", "prose"],
      `re-merge must not duplicate jobs; got ${JSON.stringify(names)}`,
    );

    // Pollution guard: only pre-commit was involved, so the merge must not
    // invent a commit-msg section. The naive `(.commit-msg.jobs //= []) | ...`
    // dedup form would materialize an empty `commit-msg:` key here.
    const hasCommitMsg = spawnSync("yq", ["-o=json", 'has("commit-msg")'], {
      input: merged,
      encoding: "utf8",
    });
    assert.equal(
      hasCommitMsg.status,
      0,
      `yq parse failed:\n${hasCommitMsg.stderr}`,
    );
    assert.equal(
      hasCommitMsg.stdout.trim(),
      "false",
      "merge must not invent a commit-msg section when only pre-commit was involved",
    );
  });
});

describe("no controlling tty: prompts fall back to defaults (set -e safe)", () => {
  // One bug, five sites: `set -eu` + a `printf ... >/dev/tty` that aborts the
  // whole script when /dev/tty can't be *opened* (no controlling terminal).
  // `[ -r /dev/tty ]` checks the device's mode bits, which pass even with no
  // tty, so the guard lies and execution falls into the bare printf. Each test
  // forces the no-tty path via `detached: true` and drives ONE site.

  it("tty/RULES: defaults FEATHER_RULES with no tty and no /dev/tty noise", () => {
    const res = runInstall({
      detached: true,
      env: {
        FEATHER_YES: "0", // bypass the YES short-circuit so the gate is reached
        FEATHER_HOOKS: "", // no hooks -> line-493 prompt block skipped
        FEATHER_LANG: "typescript", // override -> LANG gate dormant
        // FEATHER_RULES intentionally unset: the gate under test.
      },
    });
    assert.equal(res.status, 0, `install.sh aborted with no tty:\n${res.stderr}`);
    // Defaulted to "markdown,comment": both rule groups present.
    for (const f of MD_RULES) {
      assert.ok(existsSync(join(res.dir, "rules", f)), `expected md rule ${f}`);
    }
    for (const f of COMMENT_RULES) {
      assert.ok(
        existsSync(join(res.dir, "rules", f)),
        `expected comment rule ${f}`,
      );
    }
    // The gate must DETECT the missing tty, not blunder into ask_yn and let its
    // printf fail noisily. The lying `[ -r /dev/tty ]` guard produces
    // "/dev/tty: Device not configured" on stderr; have_tty must not.
    assert.doesNotMatch(
      res.stderr,
      /\/dev\/tty/,
      `no-tty run must not emit /dev/tty errors:\n${res.stderr}`,
    );
  });

  it("tty/HOOKS: defaults FEATHER_HOOKS with no tty and no /dev/tty noise", () => {
    const res = runInstall({
      detached: true,
      env: {
        FEATHER_YES: "0",
        FEATHER_RULES: "markdown", // override -> RULES gate dormant, no comment -> LANG skipped
        FEATHER_RUN_INSTALL: "0", // line-493 prompt still unfixed -> neutralize it
        // FEATHER_HOOKS intentionally unset: the gate under test.
      },
    });
    assert.equal(res.status, 0, `install.sh aborted with no tty:\n${res.stderr}`);
    // Defaulted to both hooks.
    const lh = readFileSync(join(res.dir, "lefthook.yml"), "utf8");
    assert.match(lh, /pre-commit:/);
    assert.match(lh, /commit-msg:/);
    assert.doesNotMatch(
      res.stderr,
      /\/dev\/tty/,
      `no-tty run must not emit /dev/tty errors:\n${res.stderr}`,
    );
  });

  it("tty/LANG: defaults FEATHER_LANG with no tty (no set -e abort)", () => {
    // Unlike RULES/HOOKS, this gate's else-branch printf runs at top level under
    // active set -e, so the lying guard makes it CRASH, not just go noisy.
    const res = runInstall({
      detached: true,
      env: {
        FEATHER_YES: "0",
        FEATHER_RULES: "comment", // want_comment -> LANG gate fires
        FEATHER_HOOKS: "", // no hooks -> line-493 block skipped
        // FEATHER_LANG intentionally unset: the gate under test.
      },
    });
    assert.equal(res.status, 0, `install.sh aborted with no tty:\n${res.stderr}`);
    const rule = readFileSync(
      join(res.dir, "rules", "comment-caps-theater.yml"),
      "utf8",
    );
    assert.match(rule, /^language: typescript$/m);
    assert.doesNotMatch(
      res.stderr,
      /\/dev\/tty/,
      `no-tty run must not emit /dev/tty errors:\n${res.stderr}`,
    );
  });

  it("tty/check_deps: aborts cleanly with no tty when deps are missing", () => {
    // No tty + missing dep + no FEATHER_DEPS_CONTINUE/FEATHER_YES signal: the
    // prompt is unanswerable. Decision = Abort (honor the [y/N] default). Today
    // it crashes at the bare printf BEFORE the die, so the die message is
    // absent; the fix reaches a clean die.
    const res = runInstall({
      detached: true,
      stubs: { ...DEFAULT_STUBS, "ast-grep": "exit 127" },
      env: {
        FEATHER_YES: "0",
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        // FEATHER_DEPS_CONTINUE intentionally unset.
      },
    });
    assert.notEqual(res.status, 0, "missing dep + no tty must abort");
    // The clean-die message (lines 408/418), absent on the pre-fix crash.
    assert.match(
      res.stdout + res.stderr,
      /install the dependencies above and re-run/,
    );
    assert.doesNotMatch(
      res.stderr,
      /\/dev\/tty/,
      `abort must be clean, not a /dev/tty crash:\n${res.stderr}`,
    );
    // Aborted before any install work.
    assert.ok(!existsSync(join(res.dir, "rules")), "must not write rules on abort");
  });

  it("tty/lefthook: skips the install prompt with no tty and prints guidance", () => {
    // Hooks selected, FEATHER_RUN_INSTALL unset, not FEATHER_YES: today this
    // reaches the prompt at the very end and crashes after all install work.
    // No tty => take the default (don't run lefthook install), print guidance.
    const res = runInstall({
      detached: true,
      env: {
        FEATHER_YES: "0",
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit", // overrides -> RULES/HOOKS/LANG gates dormant
        // FEATHER_RUN_INSTALL intentionally unset: reaches the prompt.
      },
    });
    assert.equal(res.status, 0, `install.sh aborted with no tty:\n${res.stderr}`);
    assert.equal(
      res.lefthookCalled,
      false,
      "must not run lefthook install when it could not prompt",
    );
    assert.match(res.stdout + res.stderr, /ast-grep scan/, "next-steps guidance");
    assert.doesNotMatch(
      res.stderr,
      /\/dev\/tty/,
      `no-tty run must not emit /dev/tty errors:\n${res.stderr}`,
    );
  });
});

describe("policy validation: reject unknown SGCONFIG/LEFTHOOK values", () => {
  // A typo'd policy must fail fast, not silently fall through the `merge | *)`
  // wildcard and mangle the user's existing config.
  it("rejects an unknown FEATHER_SGCONFIG and leaves the file untouched", () => {
    const oldSg = "ruleDirs:\n  - my-old-rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "skpi",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.notEqual(res.status, 0, "an unknown policy must abort");
    assert.match(res.stdout + res.stderr, /FEATHER_SGCONFIG/);
    assert.equal(
      readFileSync(join(res.dir, "sgconfig.yml"), "utf8"),
      oldSg,
      "existing sgconfig.yml must be untouched",
    );
  });

  it("rejects an unknown FEATHER_LEFTHOOK and leaves the file untouched", () => {
    const oldLh = "pre-commit:\n  jobs: []\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "pre-commit",
        FEATHER_LEFTHOOK: "bogus",
      },
      seedFiles: { "lefthook.yml": oldLh },
    });
    assert.notEqual(res.status, 0, "an unknown policy must abort");
    assert.match(res.stdout + res.stderr, /FEATHER_LEFTHOOK/);
    assert.equal(
      readFileSync(join(res.dir, "lefthook.yml"), "utf8"),
      oldLh,
      "existing lefthook.yml must be untouched",
    );
  });
});

describe("sgconfig merge: block-list dup check is scoped to ruleDirs", () => {
  // A `- rules` entry under a DIFFERENT key must not convince the merge that
  // ruleDirs already lists rules. The old broad grep matched it anywhere.
  it("adds rules under ruleDirs even when `- rules` exists under another key", () => {
    const oldSg = "ruleDirs:\n  - team-rules\ntestConfigs:\n  - rules\n";
    const res = runInstall({
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_SGCONFIG: "merge",
      },
      seedFiles: { "sgconfig.yml": oldSg },
    });
    assert.equal(res.status, 0, `install.sh failed:\n${res.stderr}`);
    const sg = readFileSync(join(res.dir, "sgconfig.yml"), "utf8");
    const lines = sg.split("\n");
    const idx = lines.findIndex((l) => l === "ruleDirs:");
    assert.ok(idx >= 0, "expected a ruleDirs: block line");
    // The merge inserts `  - rules` immediately under ruleDirs:. In the buggy
    // no-op case the next line is still `  - team-rules`.
    assert.equal(
      lines[idx + 1],
      "  - rules",
      `rules must be merged under ruleDirs; got:\n${sg}`,
    );
    // team-rules survives, testConfigs' own `- rules` is left alone (two total).
    assert.match(sg, /  - team-rules/);
    assert.equal(
      sg.split("\n").filter((l) => l === "  - rules").length,
      2,
      "ruleDirs gains rules; testConfigs keeps its own",
    );
  });
});

describe("backup_if_exists: distinct names across same-timestamp reruns", () => {
  // Two rapid reruns produce the same `date +%Y...` timestamp. The backup name
  // must still be unique, or the second run clobbers the first backup.
  it("creates two distinct backups when the timestamp collides", () => {
    const dir = mkdtempSync(join(tmpdir(), "feather-install-"));
    const stubs = { ...DEFAULT_STUBS, date: "echo 20260101000000" }; // fixed ts
    const env = {
      FEATHER_RULES: "markdown",
      FEATHER_HOOKS: "",
      FEATHER_SGCONFIG: "replace",
    };
    const r1 = runInstall({
      dir,
      stubs,
      env,
      seedFiles: { "sgconfig.yml": "ruleDirs:\n  - old\n" },
    });
    assert.equal(r1.status, 0, `run 1 failed:\n${r1.stderr}`);
    // sgconfig.yml now exists (feather's) from run 1; back it up again.
    const r2 = runInstall({ dir, stubs, env });
    assert.equal(r2.status, 0, `run 2 failed:\n${r2.stderr}`);

    const backups = readdir(dir).filter((f) =>
      f.startsWith("sgconfig.yml.feather.bak."),
    );
    assert.equal(
      backups.length,
      2,
      `expected 2 distinct backups; got ${JSON.stringify(backups)}`,
    );
    assert.equal(new Set(backups).size, 2, "backup names must be unique");
  });
});

describe("token validation: reject unknown FEATHER_RULES/FEATHER_HOOKS values", () => {
  // A typo'd token silently selects nothing today (has() matches nothing) and
  // the installer exits 0 having done nothing useful. It must fail fast.
  it("rejects an unknown FEATHER_RULES token and writes no rules", () => {
    const res = runInstall({
      env: { FEATHER_RULES: "markdwn", FEATHER_HOOKS: "" },
    });
    assert.notEqual(res.status, 0, "a typo'd rule token must abort");
    assert.match(res.stdout + res.stderr, /FEATHER_RULES/);
    assert.ok(
      !existsSync(join(res.dir, "rules")),
      "must not create rules/ on an invalid token",
    );
  });

  it("rejects an unknown FEATHER_HOOKS token and writes no lefthook.yml", () => {
    const res = runInstall({
      env: { FEATHER_RULES: "markdown", FEATHER_HOOKS: "pre-comit" },
    });
    assert.notEqual(res.status, 0, "a typo'd hook token must abort");
    assert.match(res.stdout + res.stderr, /FEATHER_HOOKS/);
    assert.ok(
      !existsSync(join(res.dir, "lefthook.yml")),
      "must not write lefthook.yml on an invalid token",
    );
  });

  it("accepts an empty FEATHER_HOOKS (no tokens = no hooks)", () => {
    const res = runInstall({
      env: { FEATHER_RULES: "markdown", FEATHER_HOOKS: "" },
    });
    assert.equal(res.status, 0, `empty hook list must be valid:\n${res.stderr}`);
  });
});
