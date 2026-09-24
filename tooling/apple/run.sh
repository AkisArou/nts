#!/usr/bin/env bash
# Runs a Mach-O artifact built here on the lane's Mac (the quickemu VM, or a
# real Mac later), and returns its stdout, stderr and exit status unchanged.
#
#   tooling/apple/run.sh [--env NAME=VALUE]... <artifact> [args...]
#
# An artifact that is an application bundle (`name.app`) is copied whole and
# run as its own executable, `name.app/Contents/MacOS/name`, which is how it
# finds its `Info.plist`.
#   tooling/apple/run.sh --reachable        # exit 0 if a Mac answers, else 77
#
# NTS_APPLE_SSH names the ssh destination (default `nts-mac`, an alias in
# ~/.ssh/config; vm.md has the stanza). Exit 77 means "no Mac reachable", which
# is not a failure of the artifact: callers print SKIP for it, exactly as
# gtk-hello does without xvfb. Every other status is the artifact's own.
#
# The compiler never runs on the Mac. Only the artifact crosses.
set -uo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

reachable() { ssh "${ssh_opts[@]}" "$dest" true >/dev/null 2>&1; }

if [[ "${1:-}" == "--reachable" ]]; then
  reachable && exit 0 || exit 77
fi
# `--env NAME=VALUE`: set for the program on the Mac, which ssh does not
# forward from here.
environment=""
while [[ "${1:-}" == "--env" ]]; do
  [[ "${2:-}" == *=* ]] || { echo "--env takes NAME=VALUE" >&2; exit 2; }
  environment="$environment $(printf '%q' "$2")"
  shift 2
done
[[ $# -ge 1 ]] || { echo "usage: $0 [--env NAME=VALUE]... <artifact> [args...]" >&2; exit 2; }
artifact="$1"; shift
# Asserted before anything else: scp of a missing path and a failed run read
# as one failure otherwise.
[[ -f "$artifact" || ( -d "$artifact" && "$artifact" == *.app ) ]] ||
  { echo "no artifact at $artifact" >&2; exit 2; }
reachable || { echo "no Mac reachable at $dest" >&2; exit 77; }

remote=$(ssh "${ssh_opts[@]}" "$dest" 'mktemp -d /tmp/nts-run.XXXXXX') || exit 77
trap 'ssh "${ssh_opts[@]}" "$dest" "rm -rf $remote" >/dev/null 2>&1' EXIT
scp -q -r "${ssh_opts[@]}" "$artifact" "$dest:$remote/" || { echo "copying $artifact failed" >&2; exit 2; }
name=$(basename "$artifact")
if [[ -d "$artifact" ]]; then
  name="$name/Contents/MacOS/$(basename "$artifact" .app)"
fi
# Only when there are arguments: `printf ' %q'` with none still prints once,
# and the program receives one empty argument it was never given.
quoted=""
[[ $# -eq 0 ]] || quoted=$(printf ' %q' "$@")
ssh "${ssh_opts[@]}" "$dest" "cd $remote && chmod +x ./$name && env$environment ./$name$quoted"
