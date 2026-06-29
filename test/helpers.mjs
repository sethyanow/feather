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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// import.meta.dirname (added in 20.11) is always available on the project's
// Node 22+ floor, so derive REPO_ROOT directly from it.
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

// True only for mikefarah yq v4+ — the implementation whose `eval-all` dialect
// install.sh's merge depends on. python-yq (a jq wrapper) and mikefarah v3
// speak different dialects and would fail that merge, so they must not gate the
// real-yq tests in. Pure string parser so it's unit-testable.
export function isMikefarahYqV4(versionOutput) {
  if (!versionOutput || !/mikefarah/i.test(versionOutput)) return false;
  const m = versionOutput.match(/version\s+v?(\d+)\./i);
  return m ? Number(m[1]) >= 4 : false;
}

// Is a usable (mikefarah v4+) yq available on this machine? Tests that exercise
// yq's actual array-merge semantics gate on this.
export const hasYq = (() => {
  try {
    const res = spawnSync("yq", ["--version"], { encoding: "utf8" });
    return res.status === 0 && isMikefarahYqV4(`${res.stdout}${res.stderr ?? ""}`);
  } catch {
    return false;
  }
})();

// Run install.sh in a fresh temp dir with the given env.
// Returns { status, stdout, stderr, dir, stubDir, lefthookCalled }.
//
// realYq: when true, omit the yq stub from the stub dir AND prepend the real
// yq's directory to PATH so install.sh exercises actual yq semantics. Use for
// tests that depend on yq's array-merge behavior (the stub can't model it).
export function runInstall({
  env = {},
  stubs = DEFAULT_STUBS,
  seedFiles = {},
  realYq = false,
  // dir: reuse an existing temp dir across runs (e.g. backup-collision tests
  // need two runs in the same cwd). Defaults to a fresh mkdtemp.
  dir,
  // detached: start the child in a new session with no controlling terminal,
  // so /dev/tty cannot be opened. Deterministically exercises the no-tty path
  // (otherwise a stray /dev/tty read would block to the timeout).
  detached = false,
} = {}) {
  dir = dir ?? mkdtempSync(join(tmpdir(), "feather-install-"));
  const effectiveStubs = realYq
    ? Object.fromEntries(Object.entries(stubs).filter(([k]) => k !== "yq"))
    : stubs;
  const stubDir = makeStubDir(effectiveStubs);
  const lefthookMarker = join(dir, ".lefthook-called");

  // Re-point the lefthook stub at the marker for *this* run.
  mkdirSync(dir, { recursive: true });
  if (existsSync(lefthookMarker)) {
    unlinkSync(lefthookMarker);
  }
  if (effectiveStubs.lefthook) {
    writeFileSync(
      join(stubDir, "lefthook"),
      // An `if` (not `&&`) so a non-install invocation like `lefthook --version`
      // exits 0 — real lefthook does. A trailing `[ ... ] && touch` would leave
      // the stub exiting 1 on --version, making tool_major read lefthook as
      // missing.
      `#!/bin/sh
${effectiveStubs.lefthook}
if [ "$1" = "install" ]; then touch "${lefthookMarker}"; fi
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

  // Under realYq, prepend the directory containing the real yq binary so
  // install.sh finds it ahead of the stub dir.
  let pathPrefix = `${stubDir}`;
  if (realYq) {
    const which = spawnSync("sh", ["-c", "command -v yq"], {
      encoding: "utf8",
    }).stdout.trim();
    if (which) {
      pathPrefix = `${dirname(which)}:${stubDir}`;
    }
  }

  const fullEnv = {
    PATH: `${pathPrefix}:/usr/bin:/bin`,
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
    detached,
    // Fail fast: if install.sh ever blocks (e.g. a stray /dev/tty prompt
    // under non-interactive env), surface it as a clear test failure
    // instead of hanging the runner indefinitely.
    timeout: 30_000,
  });

  if (res.error?.code === "ETIMEDOUT") {
    throw new Error(
      `install.sh timed out after 30000ms in ${dir}:\n` +
        `--- stdout ---\n${res.stdout ?? ""}\n--- stderr ---\n${res.stderr ?? ""}`,
    );
  }

  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    dir,
    stubDir,
    lefthookCalled: existsSync(lefthookMarker),
  };
}
