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
# FEATHER_RULES / FEATHER_HOOKS / FEATHER_LANG are resolved later (see the
# "selection" block): an env var set here is an override; otherwise they are
# prompted at the tty, or take their defaults under FEATHER_YES=1. They are
# left unset on purpose so the resolver can tell "unset" from "set to empty"
# (an empty FEATHER_HOOKS is a deliberate "no hooks", not a request to prompt).
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

# die if comma-list $1 (labelled $2) holds a token outside the space-separated
# allowed set $3. An empty list = no tokens = OK. Word-splitting on the
# comma->space rewrite tolerates spaces after commas, matching has().
validate_csv() {
	_bad=""
	for _it in $(echo "$1" | tr ',' ' '); do
		case " $3 " in
		*" $_it "*) ;;
		*) _bad="${_bad:+$_bad }$_it" ;;
		esac
	done
	[ -z "$_bad" ] || die "invalid $2 value(s): ${_bad} (allowed: $(echo "$3" | tr ' ' ','))"
}

# Ask a yes/no question at the tty. $1 = label, $2 = default (Y or N). Returns
# 0 for yes, 1 for no; an empty answer takes the default. `if`-guarded at the
# call site so a "no" never trips `set -e`.
ask_yn() {
	if [ "$2" = Y ]; then _hint="[Y/n]"; else _hint="[y/N]"; fi
	printf '%s %s ' "$1" "$_hint" >/dev/tty
	read -r _ans </dev/tty 2>/dev/null || _ans=""
	[ -n "$_ans" ] || _ans="$2"
	case "$_ans" in
	y | Y | yes | YES) return 0 ;;
	*) return 1 ;;
	esac
}

# True only if /dev/tty can actually be opened (a controlling terminal exists).
# `[ -r /dev/tty ]` only checks the device's mode bits and passes even when the
# process has no controlling terminal — opening it then fails with ENXIO, which
# aborts a bare `printf ... >/dev/tty` under `set -e` (and spews "Device not
# configured" even where ask_yn's if-guard swallows the failure). Probe by
# actually opening it.
have_tty() { { : </dev/tty; } 2>/dev/null; }

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
	merge)
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

	# Block-list form: does the ruleDirs: block already have a `  - rules` entry?
	# Scoped to that block — a `- rules` under some other key (e.g. testConfigs)
	# must not block the merge.
	if block_has_rules; then
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

# Does the block-form `ruleDirs:` list already contain a `  - rules` entry?
# Scoped to the ruleDirs: block only — exits 0 (found) / 1 (not found), so a
# `- rules` under another top-level key does not count.
block_has_rules() {
	awk '
		/^ruleDirs:[[:space:]]*$/ { inblock = 1; next }
		/^[^[:space:]#]/ { inblock = 0 }
		inblock && /^[[:space:]]+- rules([[:space:]]|#.*)?$/ { found = 1 }
		END { exit found ? 0 : 1 }
	' sgconfig.yml
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
		# Two reruns in the same second share a timestamp; disambiguate with PID
		# + counter so the second backup never clobbers the first. The first,
		# uncontended write keeps the plain `<file>.feather.bak.<ts>` name.
		bak="$1.feather.bak.${ts}"
		n=0
		while [ -e "$bak" ]; do
			n=$((n + 1))
			bak="$1.feather.bak.${ts}-$$-${n}"
		done
		cp "$1" "$bak"
		log "backed up existing $1 -> $bak"
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
	merge)
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
# parser, so a real deep merge needs mikefarah yq. We don't trust `command -v
# yq` alone: an incompatible variant (e.g. python-yq, a jq wrapper) can be on
# PATH yet fail the actual `eval-all`. So we *attempt* the merge and, on any
# failure, write feather's config beside the original and tell the user how to
# finish by hand — never aborting the install under `set -e`.
merge_lefthook() {
	if command -v yq >/dev/null 2>&1; then
		# PID-suffixed temp file in cwd (POSIX sh has no mktemp). Removed on
		# both the success and failure paths below.
		tmp="./.feather-lh.$$.yml"
		printf '%s\n' "$1" >"$tmp"
		# Deep-merge (`*+` appends arrays so existing jobs survive), then
		# collapse every jobs array by name so a re-run doesn't stack a second
		# copy of feather's jobs. The recurse-and-select form only touches nodes
		# that already have a `jobs` key, so it invents no empty hook sections.
		if yq eval-all '(select(fi==0) *+ select(fi==1)) | (.. | select(has("jobs")).jobs) |= unique_by(.name)' lefthook.yml "$tmp" >lefthook.yml.merged 2>/dev/null &&
			mv lefthook.yml.merged lefthook.yml; then
			rm -f "$tmp"
			log "deep-merged feather jobs into lefthook.yml via yq"
			return 0
		fi
		rm -f "$tmp" lefthook.yml.merged
		warn "yq is present but could not merge lefthook.yml (incompatible variant?)."
	fi
	printf '%s\n' "$1" >lefthook.feather.yml
	# Signal the orchestration: lefthook.yml is unmerged, so don't run
	# `lefthook install` or claim success — feather's jobs aren't wired yet.
	lefthook_sidecar=1
	warn "wrote lefthook.feather.yml beside your existing lefthook.yml."
	warn "Install mikefarah yq (brew install yq) and re-run, or merge the jobs by hand."
}

# --- dependency detection (instruct-only; never auto-installs) ------------
#
# Detect ast-grep, lefthook, and node (major >= 22). For each missing/old
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
	# Gate each tool on what was selected: ast-grep runs the rules and the
	# pre-commit scan; lefthook wires either hook; node runs the commit-msg
	# checker. Don't demand a tool the chosen install never uses.
	if want_md || want_comment || want_precommit; then
		[ "$(tool_major ast-grep 2>/dev/null || echo "")" ] || missing="${missing} ast-grep"
	fi
	if want_precommit || want_commitmsg; then
		[ "$(tool_major lefthook 2>/dev/null || echo "")" ] || missing="${missing} lefthook"
	fi
	if want_commitmsg; then
		node_major="$(tool_major node 2>/dev/null || echo "")"
		if [ -z "$node_major" ] || [ "$node_major" -lt 22 ]; then
			missing="${missing} node"
		fi
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
			log "  - node 22+:  use nvm/brew install node, or see https://nodejs.org/"
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
	# No tty to prompt at: honor the [y/N] default (N) and abort cleanly rather
	# than crash on `printf >/dev/tty`. Opt into continuing non-interactively
	# with FEATHER_DEPS_CONTINUE=1 or FEATHER_YES=1.
	if ! have_tty; then
		die "aborting; install the dependencies above and re-run"
	fi
	printf "Continue setup anyway? [y/N] " >/dev/tty
	read -r ans </dev/tty 2>/dev/null || ans=""
	case "$ans" in
	y | Y | yes | YES) return 0 ;;
	*) die "aborting; install the dependencies above and re-run" ;;
	esac
}

# --- selection: resolve rule groups, hooks, and comment language ----------
#
# Precedence per value: an env var set (even to empty) wins as an override;
# else the default under FEATHER_YES=1; else a per-group y/N prompt at the tty;
# else the default. A list that resolves to "" means "none" — has() then
# matches nothing. Runs before check_deps so the want_* gates see the choice.

if [ -n "${FEATHER_RULES+x}" ]; then
	: # override: use the env value verbatim
elif [ "$FEATHER_YES" = 1 ] || ! have_tty; then
	FEATHER_RULES="markdown,comment"
else
	_rules=""
	if ask_yn "Install markdown prose rules?" Y; then _rules="markdown"; fi
	if ask_yn "Install comment prose rules?" Y; then _rules="${_rules:+$_rules,}comment"; fi
	FEATHER_RULES="$_rules"
fi

if [ -n "${FEATHER_HOOKS+x}" ]; then
	: # override
elif [ "$FEATHER_YES" = 1 ] || ! have_tty; then
	FEATHER_HOOKS="pre-commit,commit-msg"
else
	_hooks=""
	if ask_yn "Install the pre-commit prose hook?" Y; then _hooks="pre-commit"; fi
	if ask_yn "Install the commit-msg validator hook?" Y; then _hooks="${_hooks:+$_hooks,}commit-msg"; fi
	FEATHER_HOOKS="$_hooks"
fi

# Comment language only matters when comment rules are selected.
if want_comment; then
	if [ -n "${FEATHER_LANG+x}" ]; then
		: # override
	elif [ "$FEATHER_YES" = 1 ] || ! have_tty; then
		FEATHER_LANG="typescript"
	else
		printf 'Comment source language? [typescript] ' >/dev/tty
		read -r _lang </dev/tty 2>/dev/null || _lang=""
		[ -n "$_lang" ] || _lang="typescript"
		FEATHER_LANG="$_lang"
	fi
	# FEATHER_LANG is interpolated into a sed program in install_rules. POSIX
	# shells don't re-evaluate expanded values, so backticks/$(...) are inert,
	# but the value still becomes part of the sed program: a `/` breaks the
	# s/// and on GNU sed (Linux default) `x/;e <cmd>` injects sed's `e`
	# command, enabling RCE. ast-grep language names are plain identifiers, so
	# reject anything that isn't — this guards both override and prompt inputs.
	case "$FEATHER_LANG" in
	*[!A-Za-z0-9_-]* | "")
		die "invalid FEATHER_LANG '${FEATHER_LANG}': use only letters, digits, '_' or '-'"
		;;
	esac
fi

# Reject typo'd rule/hook tokens up front: an unknown token otherwise selects
# nothing silently and the installer exits 0 having done nothing.
validate_csv "$FEATHER_RULES" FEATHER_RULES "markdown comment"
validate_csv "$FEATHER_HOOKS" FEATHER_HOOKS "pre-commit commit-msg"

# Reject unknown write policies up front (before any backup/merge touches a
# file), so a typo can't fall through a `merge | *)` wildcard and mangle config.
case "$FEATHER_SGCONFIG" in
replace | skip | merge) ;;
*) die "invalid FEATHER_SGCONFIG '${FEATHER_SGCONFIG}': use merge, replace, or skip" ;;
esac
case "$FEATHER_LEFTHOOK" in
replace | skip | merge) ;;
*) die "invalid FEATHER_LEFTHOOK '${FEATHER_LEFTHOOK}': use merge, replace, or skip" ;;
esac

check_deps
install_rules
install_sgconfig
# Set to 1 by merge_lefthook when it falls back to the sidecar (yq missing or
# unable to merge), meaning lefthook.yml was left unmerged.
lefthook_sidecar=0
install_lefthook

# --- optional lefthook install + next steps -------------------------------

if [ "$lefthook_sidecar" = "1" ]; then
	# Merge fell back to the sidecar: lefthook.yml is unchanged, so running
	# `lefthook install` now would wire the old config and falsely report
	# success. Tell the user to finish the merge first.
	warn "feather's hooks are NOT wired: lefthook.yml was left unmerged."
	warn "Merge lefthook.feather.yml into lefthook.yml, then run: lefthook install"
elif want_precommit || want_commitmsg; then
	# Decide whether to run `lefthook install`.
	#   FEATHER_RUN_INSTALL=1 -> run; =0 -> skip.
	#   unset + FEATHER_YES=1 -> skip silently (the installer was told not
	#     to prompt, and the next-steps block tells the user to run it).
	#   unset + interactive -> ask at the tty, default N.
	run_install_hooks=0
	if [ "${FEATHER_RUN_INSTALL}" = "1" ]; then
		run_install_hooks=1
	elif [ -z "${FEATHER_RUN_INSTALL}" ] && [ "${FEATHER_YES}" != "1" ] && have_tty; then
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
