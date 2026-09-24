#!/usr/bin/env bash
# Runs a PE artifact built here on the lane's Windows machine (the quickemu VM,
# or real hardware later), and returns its stdout, stderr and exit status.
#
#   tooling/windows/run.sh <artifact.exe> [args...]
#   tooling/windows/run.sh --reachable      # exit 0 if Windows answers, else 77
#
# NTS_WINDOWS_SSH names the ssh destination (default `nts-win`, an alias in
# ~/.ssh/config; vm.md has the stanza). Exit 77 means "no Windows reachable",
# which is not a failure of the artifact: callers print SKIP for it. Every
# other status is the artifact's own.
#
# Windows' OpenSSH server runs a command through `cmd.exe`, so the remote half
# is cmd's syntax, not a POSIX shell's. The compiler never runs on Windows; only
# the artifact crosses.
set -uo pipefail

dest="${NTS_WINDOWS_SSH:-nts-win}"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

reachable() { ssh "${ssh_opts[@]}" "$dest" exit 0 >/dev/null 2>&1; }

if [[ "${1:-}" == "--reachable" ]]; then
  reachable && exit 0 || exit 77
fi
[[ $# -ge 1 ]] || { echo "usage: $0 <artifact.exe> [args...]" >&2; exit 2; }
artifact="$1"; shift
# Asserted before anything else: scp of a missing path and a failed run read
# as one failure otherwise.
[[ -f "$artifact" ]] || { echo "no artifact at $artifact" >&2; exit 2; }
reachable || { echo "no Windows reachable at $dest" >&2; exit 77; }

# A directory per run under the remote user's home, which is where a command
# over ssh starts. Named here because cmd has no `mktemp`.
remote="nts-run\\$(date +%s)-$$"
ssh "${ssh_opts[@]}" "$dest" "mkdir $remote" >/dev/null || exit 77
trap 'ssh "${ssh_opts[@]}" "$dest" "rmdir /s /q $remote" >/dev/null 2>&1' EXIT
scp -q "${ssh_opts[@]}" "$artifact" "$dest:${remote//\\//}/" || { echo "copying $artifact failed" >&2; exit 2; }
name=$(basename "$artifact")
# cmd quoting: each argument in double quotes, with no argument at all when
# there are none (a program given one empty argument it was never passed is a
# different program -- the Apple lane's `run.sh` found that).
quoted=""
for arg in "$@"; do quoted="$quoted \"${arg//\"/\\\"}\""; done
ssh "${ssh_opts[@]}" "$dest" "cd $remote && .\\$name$quoted"
