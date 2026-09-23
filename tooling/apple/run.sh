#!/usr/bin/env bash
# Runs a Mach-O artifact built here on the lane's Mac (the quickemu VM, or a
# real Mac later), and returns its stdout, stderr and exit status unchanged.
#
#   tooling/apple/run.sh <artifact> [args...]
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
[[ $# -ge 1 ]] || { echo "usage: $0 <artifact> [args...]" >&2; exit 2; }
artifact="$1"; shift
# Asserted before anything else: scp of a missing path and a failed run read
# as one failure otherwise.
[[ -f "$artifact" ]] || { echo "no artifact at $artifact" >&2; exit 2; }
reachable || { echo "no Mac reachable at $dest" >&2; exit 77; }

remote=$(ssh "${ssh_opts[@]}" "$dest" 'mktemp -d /tmp/nts-run.XXXXXX') || exit 77
trap 'ssh "${ssh_opts[@]}" "$dest" "rm -rf $remote" >/dev/null 2>&1' EXIT
scp -q "${ssh_opts[@]}" "$artifact" "$dest:$remote/" || { echo "copying $artifact failed" >&2; exit 2; }
name=$(basename "$artifact")
quoted=$(printf ' %q' "$@")
ssh "${ssh_opts[@]}" "$dest" "cd $remote && chmod +x ./$name && ./$name$quoted"
