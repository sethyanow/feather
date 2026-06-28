// Tests for install.sh. Grown one slice at a time (red -> green).
//
// The harness lives in ./helpers.mjs: it spawns install.sh in a temp dir with
// a stubbed PATH and FEATHER_SRC pointed at the repo checkout, and drives all
// selection via FEATHER_* env vars.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMITTED_LEFTHOOK,
  COMMENT_RULES,
  DEFAULT_STUBS,
  MD_RULES,
  readdir,
  runInstall,
} from "./helpers.mjs";
import { existsSync, readFileSync } from "node:fs";
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

  it("aborts on old node (<18) with an install hint", () => {
    const res = runInstall({
      stubs: { ...DEFAULT_STUBS, node: 'echo "v17.0.0"' },
      env: {
        FEATHER_RULES: "markdown",
        FEATHER_HOOKS: "",
        FEATHER_DEPS_CONTINUE: "0",
      },
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /node/i);
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
