#!/usr/bin/env bash
# Runs a Mach-O artifact built here on the lane's Mac (the quickemu VM, or a
# real Mac later), and returns its stdout, stderr and exit status unchanged.
#
#   tooling/apple/run.sh [--env NAME=VALUE]... <artifact> [args...]
#
# An artifact that is an application bundle (`name.app`) is copied whole and
# run as its own executable, `name.app/Contents/MacOS/name`, which is how it
# finds its `Info.plist`. A bare program is copied with the frameworks beside
# it, which it loads from there.
#   tooling/apple/run.sh --reachable        # exit 0 if a Mac answers, else 77
#   tooling/apple/run.sh --gui              # exit 0 if a user is logged in to
#                                           # its desktop, else 77
#
# NTS_APPLE_SSH names the ssh destination (default `nts-mac`, an alias in
# ~/.ssh/config; vm.md has the stanza). Exit 77 means "no Mac reachable", which
# is not a failure of the artifact: callers print SKIP for it, exactly as
# gtk-hello does without xvfb. 124 is a run that outlasted NTS_APPLE_TIMEOUT.
# Every other status is the artifact's own.
#
# The compiler never runs on the Mac. Only the artifact crosses.
set -uo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
# A Mac that stops answering mid-run -- the VM rebooted under a run on
# 2026-09-26 -- ends the connection within a minute rather than never.
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

# Reachable means it answers, not that it answers within ssh_opts' 5 s. The
# first Apple project of a gate probes at the gate's busiest moment, and a VM
# guest starved of host CPU then missed even one 30 s connect (ios-form, two
# trains, 2026-10-16) while answering at once alone. So an attempt that timed
# out is tried again, up to three; one that failed fast -- a refused port, a
# Mac that is down, 6 ms -- is not, so a missing Mac costs nothing. The first
# ConnectTimeout given is the one ssh uses. Why it gave up goes to stderr.
reachable() {
  local try started said
  for try in 1 2 3; do
    started=$SECONDS
    said=$(ssh -o ConnectTimeout=30 "${ssh_opts[@]}" "$dest" true 2>&1 >/dev/null) && return 0
    (( SECONDS - started >= 25 )) || break
  done
  echo "no Mac reachable at $dest after $try attempt(s): ${said##*$'\n'}" >&2
  return 1
}

# One artifact on the Mac at a time, for every caller of this script and of
# its sibling (run.sh / run-ios.sh take the same lock). The gate's interop step
# builds its projects in parallel, and a 4 GB VM running an iOS simulator beside
# AppKit apps, on a host busy with the rest of the gate, stopped answering ssh
# within ConnectTimeout: the first project timed out and every one after it read
# "no Mac reachable" (two trains, 2026-10-16), where the same step alone ran all
# 61. Taken before the reachability probe too, so a probe never measures a Mac
# busy with someone else's run; held until this script exits.
exec 9>"${XDG_CACHE_HOME:-$HOME/.cache}/nts-mac.lock"
flock 9

if [[ "${1:-}" == "--reachable" ]]; then
  reachable && exit 0 || exit 77
fi
# Whether an application can put up a window: a user logged in to the
# desktop, whose Dock runs. After a reboot with no automatic login the Mac
# answers ssh from its login window, and AppKit's apps -- their Swift twins
# too -- print NSXPCSharedListener errors and never finish launching. That is
# the Mac, not the artifact, so a caller skips on 77 and names this reason. It
# asks for the session and never for a symptom, so an app that fails with a
# session present still fails.
if [[ "${1:-}" == "--gui" ]]; then
  ssh "${ssh_opts[@]}" "$dest" 'pgrep -x Dock >/dev/null' >/dev/null 2>&1 && exit 0 || exit 77
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
# The dynamic frameworks a bare program loads from beside it
# (`@executable_path`), where `nts build` ships a library's: copied with it,
# by tar, so a framework's `Versions` links arrive as links.
if [[ -f "$artifact" ]]; then
  beside=$(dirname "$artifact")
  frameworks=("$beside"/*.framework)
  if [[ -d "${frameworks[0]}" ]]; then
    (cd "$beside" && tar cf - -- *.framework) | ssh "${ssh_opts[@]}" "$dest" "cd $remote && tar xf -" ||
      { echo "copying the frameworks beside $artifact failed" >&2; exit 2; }
  fi
fi
name=$(basename "$artifact")
if [[ -d "$artifact" ]]; then
  name="$name/Contents/MacOS/$(basename "$artifact" .app)"
fi
# Only when there are arguments: `printf ' %q'` with none still prints once,
# and the program receives one empty argument it was never given.
quoted=""
[[ $# -eq 0 ]] || quoted=$(printf ' %q' "$@")
# A run that never ends is the one outcome a caller cannot report, so one
# that outlasts NTS_APPLE_TIMEOUT seconds (default 600) is ended, says so,
# and exits 124.
limit="${NTS_APPLE_TIMEOUT:-600}"
timeout -k 10 "$limit" ssh "${ssh_opts[@]}" "$dest" "cd $remote && chmod +x ./$name && env$environment ./$name$quoted"
status=$?
[[ $status -ne 124 ]] || echo "run.sh: $name did not finish on the Mac in $limit s (NTS_APPLE_TIMEOUT)" >&2
exit "$status"
