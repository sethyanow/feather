#!/bin/sh
# feather installer — see README.md and docs/adapting.md.
#
# curl | sh safe: prompts read from /dev/tty, defaults so FEATHER_YES=1 runs
# non-interactively. Behavior built up test-by-test in test/install.test.mjs.
#
# Env overrides (all optional):
#   FEATHER_SRC         local checkout dir -> fetch via cp (no network)
#   FEATHER_BASE_URL    raw URL root (default: .../sethyanow/feather/<ref>)
#   FEATHER_REF         branch/tag (default: main)
#   FEATHER_YES         1 = accept all defaults, no prompts
#   FEATHER_RULES       comma list: markdown,comment (default: markdown,comment)
#   FEATHER_HOOKS       comma list: pre-commit,commit-msg (default: both)
#   FEATHER_LANG        comment rule language (default: typescript)
#   FEATHER_RUN_INSTALL 1 = run lefthook install, 0 = skip; unset + interactive
#                        prompts at the tty (default N), unset + FEATHER_YES=1
#                        skips silently
#   FEATHER_SGCONFIG    merge|replace|skip (default: merge)
#   FEATHER_LEFTHOOK    merge|replace|skip (default: merge)

set -eu

# --- defaults -------------------------------------------------------------

FEATHER_REF="${FEATHER_REF:-main}"
FEATHER_BASE_URL="${FEATHER_BASE_URL:-https://raw.githubusercontent.com/sethyanow/feather/${FEATHER_REF}}"
FEATHER_YES="${FEATHER_YES:-0}"
FEATHER_RULES="${FEATHER_RULES-markdown,comment}"
FEATHER_HOOKS="${FEATHER_HOOKS-pre-commit,commit-msg}"
FEATHER_LANG="${FEATHER_LANG:-typescript}"
FEATHER_RUN_INSTALL="${FEATHER_RUN_INSTALL:-}"
FEATHER_SGCONFIG="${FEATHER_SGCONFIG:-merge}"
FEATHER_LEFTHOOK="${FEATHER_LEFTHOOK:-merge}"
# Non-interactive dep gate: 1 = continue even if deps are missing/old,
# 0 = abort. Under FEATHER_YES=1 the default is to continue (the installer
# was told not to prompt); otherwise the user is asked at the tty.
FEATHER_DEPS_CONTINUE="${FEATHER_DEPS_CONTINUE:-}"

MD_RULES="md-caps-theater.yml md-heading-over-50.yml md-load-bearing.yml md-paragraph-line-over-80.yml md-paragraph-wall.yml"
COMMENT_RULES="comment-caps-theater.yml comment-load-bearing.yml comment-narrative-wall.yml comment-source-line-cite.yml"

# --- helpers --------------------------------------------------------------

log() { printf '%s\n' "$*"; }
warn() { printf 'feather: %s\n' "$*" >&2; }
die() {
	warn "$*"
	exit 1
}

# FEATHER_LANG is interpolated into a sed program in install_rules. POSIX
# shells don't re-evaluate expanded values, so backticks/$(...) are inert,
# but the value still becomes part of the sed program: a `/` breaks the s///
# and on GNU sed (Linux default) `x/;e <cmd>` injects sed's `e` command,
# enabling RCE. ast-grep language names are plain identifiers, so reject
# anything that isn't.
case "$FEATHER_LANG" in
*[!A-Za-z0-9_-]* | "")
	die "invalid FEATHER_LANG '${FEATHER_LANG}': use only letters, digits, '_' or '-'"
	;;
esac

# Fetch a single path from FEATHER_SRC (cp) or FEATHER_BASE_URL (curl).
# $1 = repo-relative path, $2 = destination path.
fetch() {
	repo_path="$1"
	dest="$2"
	if [ -n "${FEATHER_SRC:-}" ]; then
		cp "${FEATHER_SRC}/${repo_path}" "${dest}"
	else
		curl -fsSL "${FEATHER_BASE_URL}/${repo_path}" -o "${dest}"
	fi
}

# Does a comma list ($1) contain a word ($2)? Tolerates spaces around commas
# so "markdown, comment" matches "comment" the same as "markdown,comment".
has() {
	echo ",$1," | tr -d ' \t' | grep -q ",$2,"
}

# --- selection ------------------------------------------------------------

want_md() { has "$FEATHER_RULES" markdown; }
want_comment() { has "$FEATHER_RULES" comment; }
want_precommit() { has "$FEATHER_HOOKS" pre-commit; }
want_commitmsg() { has "$FEATHER_HOOKS" commit-msg; }

# --- rule fetching --------------------------------------------------------

install_rules() {
	mkdir -p rules
	if want_md; then
		for f in $MD_RULES; do
			fetch "rules/${f}" "rules/${f}"
		done
		log "copied markdown rules"
	fi
	if want_comment; then
		for f in $COMMENT_RULES; do
			fetch "rules/${f}" "rules/${f}"
			# Rewrite `language: <x>` to the user's choice. Portable sed: write to
			# a temp file then move, since macOS sed -i needs an arg.
			sed "s/^language: .*/language: ${FEATHER_LANG}/" "rules/${f}" >"rules/${f}.tmp"
			mv "rules/${f}.tmp" "rules/${f}"
		done
		log "copied comment rules (language: ${FEATHER_LANG})"
	fi
}

# --- ast-grep config ------------------------------------------------------

install_sgconfig() {
	if ! want_md && ! want_comment; then
		return 0
	fi

	feather_sg="ruleDirs:
  - rules
"

	if [ ! -f sgconfig.yml ]; then
		printf '%s' "$feather_sg" >sgconfig.yml
		log "wrote sgconfig.yml"
		return 0
	fi

	# Existing file: back up, then apply policy.
	backup_if_exists sgconfig.yml
	case "$FEATHER_SGCONFIG" in
	replace)
		printf '%s' "$feather_sg" >sgconfig.yml
		log "replaced sgconfig.yml"
		;;
	skip)
		log "left existing sgconfig.yml untouched (FEATHER_SGCONFIG=skip)"
		;;
	merge | *)
		merge_sgconfig "$feather_sg"
		;;
	esac
}

# Merge feather's ruleDirs into an existing sgconfig.yml. Handles three forms:
#   - block list:  ruleDirs:\n  - team-rules   -> append `  - rules`
#   - inline list: ruleDirs: [team-rules]       -> inject `rules` into brackets
#   - none:                                   -> append a new ruleDirs block
merge_sgconfig() {
	# Inline ruleDirs: [...] form?
	if grep -qE "^ruleDirs:[[:space:]]*\[" sgconfig.yml; then
		# Is `rules` already an entry in the inline list? Extract the bracket
		# contents, split on commas, and look for an exact match. (Word-boundary
		# greps misfire on `team-rules`, which contains the substring.)
		if inline_has_rules; then
			log "sgconfig.yml already lists rules; nothing to merge"
			return 0
		fi
		# Insert `rules` after the opening bracket as a bare scalar.
		sed -E "/^ruleDirs:[[:space:]]*\[/s/(\[)/\1rules, /" sgconfig.yml >sgconfig.yml.tmp
		mv sgconfig.yml.tmp sgconfig.yml
		log "merged rules into existing inline sgconfig.yml ruleDirs"
		return 0
	fi

	# Block-list form: already has a `  - rules` entry?
	if grep -qE "^[[:space:]]+- rules([[:space:]]|#.*)?$" sgconfig.yml; then
		log "sgconfig.yml already lists rules; nothing to merge"
		return 0
	fi

	if grep -q "^ruleDirs:" sgconfig.yml; then
		# Block list: append `  - rules` after the ruleDirs: line.
		awk '/^ruleDirs:/{print; print "  - rules"; next}1' sgconfig.yml >sgconfig.yml.tmp
		mv sgconfig.yml.tmp sgconfig.yml
		log "merged rules into existing sgconfig.yml ruleDirs"
	else
		printf '\n%s\n' "$1" >>sgconfig.yml
		log "appended ruleDirs: [rules] to sgconfig.yml"
	fi
}

# Does the first `ruleDirs: [...]` line in sgconfig.yml list `rules` as an
# entry? Reads the file from stdin-less global state (sgconfig.yml in cwd).
inline_has_rules() {
	# Strip everything except the bracket contents, one entry per line, and
	# look for an exact `rules` match.
	sed -nE 's/^ruleDirs:[[:space:]]*\[(.*)\].*/\1/p' sgconfig.yml |
		tr ',' '\n' |
		sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' |
		grep -qx 'rules'
}

# --- lefthook config ------------------------------------------------------

# --- config write policy: backup, then merge/replace/skip ----------------
#
# Every generated config goes through here. If the file already exists it is
# always backed up to <file>.feather.bak.<timestamp> before any change.
# Then the per-file policy (merge|replace|skip) decides what lands.
#
#   write_config <path> <feather-content> <policy> <merge-callback>
# The merge callback is invoked only for policy=merge when the file exists;
# it receives the existing path and must perform the merge in place.

backup_if_exists() {
	if [ -f "$1" ]; then
		ts=$(date +%Y%m%d%H%M%S)
		cp "$1" "$1.feather.bak.${ts}"
		log "backed up existing $1 -> $1.feather.bak.${ts}"
		return 0
	fi
	return 1
}

# Emit the file header (comments + output block) shared by every variant.
lefthook_header() {
	cat <<'EOF'
# Git hooks, run via lefthook. After editing, run `lefthook install` to wire
# the dispatchers into .git/hooks.
#
# Two tiers, by design:
#   - Prose rules run on staged files. Most are hint/warning and exit 0, so they
#     print findings without blocking — the floor for new writing while a
#     backlog is cleaned. The *-load-bearing rules ship at `error`, so a match
#     blocks the commit; promote others the same way once they are clean.
#   - The commit-msg validator hard-enforces the message convention. It blocks
#     before the commit lands, so re-run with a corrected message.
#
# Adapt the `glob` to your source extensions and point the commit-msg `run` at
# wherever you vend the checker. See docs/adapting.md.

# Show command stdout even when a job passes, so hint output reaches the reader.
output:
  - summary
  - failure
  - execution_out
EOF
}

install_lefthook() {
	if ! want_precommit && ! want_commitmsg; then
		return 0
	fi

	# Assemble feather's full lefthook.yml into a variable. POSIX sh has no
	# mktemp, so build it via `$(...)` capture. Command substitution strips
	# trailing newlines, so each heredoc carries exactly one trailing blank
	# line and the next block carries a leading blank — the drift-guard test
	# asserts the final bytes match the committed lefthook.yml.
	feather_lh=$(lefthook_header)
	if want_precommit; then
		block=$(
			cat <<'EOF'

pre-commit:
  jobs:
    - name: prose
      glob: "*.{ts,tsx,js,md}"
      # Skip dot-directories (.github, .vendor, ...) — installed/vendored
      # content, not your authored prose.
      exclude:
        - ".*"
        - "*/.*"
      run: ast-grep scan {staged_files}
EOF
		)
		feather_lh="${feather_lh}
${block}"
	fi
	if want_commitmsg; then
		block=$(
			cat <<'EOF'

commit-msg:
  jobs:
    - name: commit-style
      run: node scripts/check-commit-msg.mjs {1}
EOF
		)
		feather_lh="${feather_lh}
${block}"
	fi

	if [ ! -f lefthook.yml ]; then
		fetch_commitmsg_checker_if_wanted
		printf '%s\n' "$feather_lh" >lefthook.yml
		log "wrote lefthook.yml"
		return 0
	fi

	backup_if_exists lefthook.yml
	case "$FEATHER_LEFTHOOK" in
	replace)
		fetch_commitmsg_checker_if_wanted
		printf '%s\n' "$feather_lh" >lefthook.yml
		log "replaced lefthook.yml"
		;;
	skip)
		log "left existing lefthook.yml untouched (FEATHER_LEFTHOOK=skip)"
		;;
	merge | *)
		fetch_commitmsg_checker_if_wanted
		merge_lefthook "$feather_lh"
		;;
	esac
}

# Fetch scripts/check-commit-msg.mjs, but only when the commit-msg hook was
# selected. Skipped on FEATHER_LEFTHOOK=skip because the caller never reaches
# here in that case — the checker is a repo-local asset and must not be
# silently overwritten when the user told us to leave their config alone.
fetch_commitmsg_checker_if_wanted() {
	if want_commitmsg; then
		mkdir -p scripts
		fetch "scripts/check-commit-msg.mjs" "scripts/check-commit-msg.mjs"
	fi
}

# Merge feather's jobs into an existing lefthook.yml. POSIX sh has no YAML
# parser, so a real deep merge needs yq; without it we write feather's config
# beside the original and tell the user how to finish the merge.
merge_lefthook() {
	if command -v yq >/dev/null 2>&1; then
		# PID-suffixed temp file in cwd (POSIX sh has no mktemp). Cleaned up
		# on every exit path below, including die().
		tmp="./.feather-lh.$$.yml"
		printf '%s\n' "$1" >"$tmp"
		yq eval-all 'select(fi==0) *+ select(fi==1)' lefthook.yml "$tmp" >lefthook.yml.merged
		mv lefthook.yml.merged lefthook.yml
		rm -f "$tmp"
		log "deep-merged feather jobs into lefthook.yml via yq"
	else
		printf '%s\n' "$1" >lefthook.feather.yml
		warn "lefthook.yml exists and yq is not installed; wrote lefthook.feather.yml."
		warn "Install yq (brew install yq) and re-run, or merge the jobs by hand."
	fi
}

# --- dependency detection (instruct-only; never auto-installs) ------------
#
# Detect ast-grep, lefthook, and node (major >= 18). For each missing/old
# tool, print the exact install command. Then ask whether to continue — the
# installer never installs anything itself.

# Print the major version number from a tool's --version-ish output, or "" if
# the tool is missing. $1 = tool name. POSIX-only: no `grep -o`, which is a
# GNU/BSD extension; use sed to isolate the first run of digits.
tool_major() {
	cmd="$1"
	out=$("$cmd" --version 2>/dev/null) || out=$("$cmd" version 2>/dev/null) || return 1
	# Grab the first run of digits we see.
	echo "$out" | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -n1
}

check_deps() {
	missing=""
	[ "$(tool_major ast-grep 2>/dev/null || echo "")" ] || missing="${missing} ast-grep"
	[ "$(tool_major lefthook 2>/dev/null || echo "")" ] || missing="${missing} lefthook"

	node_major="$(tool_major node 2>/dev/null || echo "")"
	if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
		missing="${missing} node"
	fi

	if [ -z "$missing" ]; then
		return 0
	fi

	warn "some dependencies are missing or too old:"
	for t in $missing; do
		case "$t" in
		ast-grep)
			log "  - ast-grep:  brew install ast-grep   |   cargo install ast-grep   |   npm i -g @ast-grep/cli"
			;;
		lefthook)
			log "  - lefthook:  brew install lefthook   |   npm i -g lefthook"
			;;
		node)
			log "  - node 18+:  use nvm/brew install node, or see https://nodejs.org/"
			;;
		esac
	done
	log "feather does not install these for you. Install them, or continue anyway."

	# Decide continue/abort. An explicit FEATHER_DEPS_CONTINUE wins over
	# FEATHER_YES: 1 = continue, 0 = abort. Without it, FEATHER_YES=1 continues
	# non-interactively; otherwise ask at the tty.
	if [ "${FEATHER_DEPS_CONTINUE}" = "1" ]; then
		warn "continuing despite missing deps (FEATHER_DEPS_CONTINUE=1)"
		return 0
	fi
	if [ "${FEATHER_DEPS_CONTINUE}" = "0" ]; then
		die "aborting; install the dependencies above and re-run"
	fi
	if [ "${FEATHER_YES}" = "1" ]; then
		warn "continuing despite missing deps (FEATHER_YES=1)"
		return 0
	fi
	printf "Continue setup anyway? [y/N] " >/dev/tty
	read -r ans </dev/tty 2>/dev/null || ans=""
	case "$ans" in
	y | Y | yes | YES) return 0 ;;
	*) die "aborting; install the dependencies above and re-run" ;;
	esac
}

check_deps
install_rules
install_sgconfig
install_lefthook

# --- optional lefthook install + next steps -------------------------------

if want_precommit || want_commitmsg; then
	# Decide whether to run `lefthook install`.
	#   FEATHER_RUN_INSTALL=1 -> run; =0 -> skip.
	#   unset + FEATHER_YES=1 -> skip silently (the installer was told not
	#     to prompt, and the next-steps block tells the user to run it).
	#   unset + interactive -> ask at the tty, default N.
	run_install_hooks=0
	if [ "${FEATHER_RUN_INSTALL}" = "1" ]; then
		run_install_hooks=1
	elif [ -z "${FEATHER_RUN_INSTALL}" ] && [ "${FEATHER_YES}" != "1" ]; then
		printf "Run lefthook install now? [y/N] " >/dev/tty
		read -r ans </dev/tty 2>/dev/null || ans=""
		case "$ans" in
		y | Y | yes | YES) run_install_hooks=1 ;;
		esac
	fi

	if [ "$run_install_hooks" = "1" ]; then
		log "running lefthook install..."
		lefthook install
		log "hooks installed"
	fi
fi

log ""
log "feather setup complete. Next steps:"
log "  - audit your tree:   ast-grep scan"
log "  - (if you skipped it) wire hooks:   lefthook install"
log "  - adapt to your repo:   see docs/adapting.md"
