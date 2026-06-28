// Test harness for install.sh.
//
// Spawns install.sh in a temp dir with a stubbed PATH (so no real
// ast-grep/lefthook/yq are needed) and FEATHER_SRC pointing at the repo
// checkout (so file fetching uses `cp`, no network). All selection is driven
// by FEATHER_* env vars — install.sh never prompts interactively under tests.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..");
export const INSTALL_SH = join(REPO_ROOT, "install.sh");

// The set of rule files install.sh knows about.
export const MD_RULES = [
  "md-caps-theater.yml",
  "md-heading-over-50.yml",
  "md-load-bearing.yml",
  "md-paragraph-line-over-80.yml",
  "md-paragraph-wall.yml",
];
export const COMMENT_RULES = [
  "comment-caps-theater.yml",
  "comment-load-bearing.yml",
  "comment-narrative-wall.yml",
  "comment-source-line-cite.yml",
];

// The committed lefthook.yml is the drift target: when the installer selects
// all rule groups and both hooks (the repo's own defaults), its assembled
// output must match this byte-for-byte.
export const COMMITTED_LEFTHOOK = readFileSync(
  join(REPO_ROOT, "lefthook.yml"),
  "utf8",
);
export const readdir = readdirSync;

// Build a fake PATH directory containing stub executables for the tools
// install.sh probes. Each stub records its args to a marker file so tests can
// assert that lefthook install was actually invoked.
function makeStubDir(tools) {
  const dir = mkdtempSync(join(tmpdir(), "feather-stubs-"));
  for (const [name, body] of Object.entries(tools)) {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

// Default happy-path stubs: everything present, versions new enough.
export const DEFAULT_STUBS = {
  "ast-grep": 'echo "ast-grep 0.34.0"',
  "lefthook": 'echo "lefthook 1.10.0"',
  // Track lefthook invocations so tests can assert `lefthook install` ran.
  node: 'echo "v22.0.0"',
  yq: 'echo "v4.44.0"',
};

// Run install.sh in a fresh temp dir with the given env.
// Returns { status, stdout, stderr, dir, stubDir, lefthookCalled }.
export function runInstall({
  env = {},
  stubs = DEFAULT_STUBS,
  seedFiles = {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "feather-install-"));
  const stubDir = makeStubDir(stubs);
  const lefthookMarker = join(dir, ".lefthook-called");

  // Re-point the lefthook stub at the marker for *this* run.
  mkdirSync(dir, { recursive: true });
  if (stubs.lefthook) {
    writeFileSync(
      join(stubDir, "lefthook"),
      `#!/bin/sh
${stubs.lefthook}
[ "$1" = "install" ] && touch "${lefthookMarker}"
`,
    );
    chmodSync(join(stubDir, "lefthook"), 0o755);
  }

  // Seed pre-existing files (for backup/merge tests).
  for (const [rel, content] of Object.entries(seedFiles)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }

  const fullEnv = {
    PATH: `${stubDir}:/usr/bin:/bin`,
    HOME: process.env.HOME,
    SHELL: process.env.SHELL ?? "/bin/sh",
    // Drive the installer non-interactively and from the repo checkout.
    FEATHER_YES: "1",
    FEATHER_SRC: REPO_ROOT,
    ...env,
  };

  const res = spawnSync("sh", [INSTALL_SH], {
    cwd: dir,
    env: fullEnv,
    encoding: "utf8",
  });

  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    dir,
    stubDir,
    lefthookCalled: existsSync(lefthookMarker),
  };
}
