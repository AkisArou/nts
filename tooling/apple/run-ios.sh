#!/usr/bin/env bash
# Runs an iOS application bundle built here on the lane's Mac's iOS
# simulator, and returns its stdout and stderr.
#
#   tooling/apple/run-ios.sh <name>.app
#   tooling/apple/run-ios.sh --reachable      # Mac and simulator ready; 77 if no Mac
#
# The bundle is copied over, the simulator booted if it is not
# (`NTS_IOS_DEVICE`, default `iPhone 17`), the application installed and
# launched with its console attached, which returns once the application
# exits. The line `simctl` adds, `<bundle id>: <pid>`, is not the
# application's and is left out.
#
# NTS_APPLE_SSH names the ssh destination, as for run.sh. Exit 77 means "no Mac
# reachable", which callers print SKIP for. A reachable Mac whose configured
# simulator cannot boot is a failure, never a skip. NTS_IOS_READY_TIMEOUT bounds
# readiness (default 600 s), separately from NTS_IOS_TIMEOUT (default 300 s)
# for install/launch and the attached application. Stage times go to stderr;
# application stdout is unchanged. `launch-and-app` measures simctl's attached
# launch call, including the application's execution.
set -uo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
device="${NTS_IOS_DEVICE:-iPhone 17}"
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

stage_time() {
  local stage_name=$1 stage_status stage_started=$SECONDS
  shift
  printf 'run-ios: %s begin\n' "$stage_name" >&2
  "$@"
  stage_status=$?
  printf 'run-ios: %s exit %s after %ss\n' "$stage_name" "$stage_status" "$((SECONDS - stage_started))" >&2
  return "$stage_status"
}

ready() {
  reachable || return 77
  local ready_limit=${NTS_IOS_READY_TIMEOUT:-600} ready_status=0
  # Paid before the application's deadline: the first cold simulator arms
  # timed out at 300 s, while the same applications ran in seconds once warm.
  stage_time "readiness ($device)" timeout -k 10 "$ready_limit" \
    ssh "${ssh_opts[@]}" "$dest" "xcrun simctl bootstatus $(printf '%q' "$device") -b" >&2 || ready_status=$?
  if [[ $ready_status -ne 0 ]]; then
    echo "run-ios.sh: configured simulator '$device' did not become ready (exit $ready_status, NTS_IOS_READY_TIMEOUT=$ready_limit s)" >&2
    [[ $ready_status -ne 124 ]] || return 124
    return 1
  fi
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
  ready
  exit $?
fi
[[ $# -eq 1 && -d "$1" && "$1" == *.app ]] || { echo "usage: $0 <name>.app" >&2; exit 2; }
bundle="$1"
id=$(sed -n '/<key>CFBundleIdentifier<\/key>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' "$bundle/Info.plist")
[[ -n "$id" ]] || { echo "no CFBundleIdentifier in $bundle/Info.plist" >&2; exit 2; }
ready || exit $?

remote=$(ssh "${ssh_opts[@]}" "$dest" mktemp -d /tmp/nts-ios.XXXXXX)
scp -q -r "${ssh_opts[@]}" "$bundle" "$dest:$remote/"
name=$(basename "$bundle")
# Installing and the application's own run, bounded: an application
# that never finishes is ended after NTS_IOS_TIMEOUT seconds (default 300),
# says so by name, and exits 124, where it once held a gate for 76 minutes.
limit="${NTS_IOS_TIMEOUT:-300}"
timeout -k 10 "$limit" ssh "${ssh_opts[@]}" "$dest" "$(declare -f stage_time)
  stage_time install xcrun simctl install $(printf '%q' "$device") $(printf '%q' "$remote/$name") &&
  stage_time launch-and-app xcrun simctl launch --console --terminate-running-process $(printf '%q' "$device") $(printf '%q' "$id")" |
  grep -v "^$id: [0-9][0-9]*\$"
status=${PIPESTATUS[0]}
case $status in
  124) echo "run-ios.sh: the simulator did not finish $id in $limit s (NTS_IOS_TIMEOUT)" >&2 ;;
  255) echo "run-ios.sh: the connection to $dest ended during the run" >&2 ;;
esac
ssh "${ssh_opts[@]}" "$dest" "rm -rf '$remote'" >/dev/null 2>&1
exit "$status"
