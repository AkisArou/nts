#!/usr/bin/env bash
# Runs an iOS application bundle built here on the lane's Mac's iOS
# simulator, and returns its stdout and stderr.
#
#   tooling/apple/run-ios.sh <name>.app
#   tooling/apple/run-ios.sh --reachable      # exit 0 if a Mac answers, else 77
#
# The bundle is copied over, the simulator booted if it is not
# (`NTS_IOS_DEVICE`, default `iPhone 17`), the application installed and
# launched with its console attached, which returns once the application
# exits. The line `simctl` adds, `<bundle id>: <pid>`, is not the
# application's and is left out.
#
# NTS_APPLE_SSH names the ssh destination, as for run.sh. Exit 77 means "no Mac
# reachable", which callers print SKIP for; 124, a run that outlasted
# NTS_IOS_TIMEOUT; 255, a connection that ended during the run.
set -uo pipefail

dest="${NTS_APPLE_SSH:-nts-mac}"
device="${NTS_IOS_DEVICE:-iPhone 17}"
# A Mac that stops answering mid-run -- the VM rebooted under a run on
# 2026-09-26 -- ends the connection within a minute rather than never.
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

reachable() { ssh "${ssh_opts[@]}" "$dest" true >/dev/null 2>&1; }

if [[ "${1:-}" == "--reachable" ]]; then
  reachable && exit 0 || exit 77
fi
[[ $# -eq 1 && -d "$1" && "$1" == *.app ]] || { echo "usage: $0 <name>.app" >&2; exit 2; }
bundle="$1"
id=$(sed -n '/<key>CFBundleIdentifier<\/key>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' "$bundle/Info.plist")
[[ -n "$id" ]] || { echo "no CFBundleIdentifier in $bundle/Info.plist" >&2; exit 2; }
reachable || exit 77

remote=$(ssh "${ssh_opts[@]}" "$dest" mktemp -d /tmp/nts-ios.XXXXXX)
scp -q -r "${ssh_opts[@]}" "$bundle" "$dest:$remote/"
name=$(basename "$bundle")
# Booting, installing and the application's own run, bounded: a simulator
# that never finishes is ended after NTS_IOS_TIMEOUT seconds (default 300),
# says so by name, and exits 124, where it once held a gate for 76 minutes.
limit="${NTS_IOS_TIMEOUT:-300}"
timeout -k 10 "$limit" ssh "${ssh_opts[@]}" "$dest" "xcrun simctl bootstatus '$device' -b >/dev/null 2>&1 &&
  xcrun simctl install '$device' '$remote/$name' &&
  xcrun simctl launch --console --terminate-running-process '$device' '$id'" |
  grep -v "^$id: [0-9][0-9]*\$"
status=${PIPESTATUS[0]}
case $status in
  124) echo "run-ios.sh: the simulator did not finish $id in $limit s (NTS_IOS_TIMEOUT)" >&2 ;;
  255) echo "run-ios.sh: the connection to $dest ended during the run" >&2 ;;
esac
ssh "${ssh_opts[@]}" "$dest" "rm -rf '$remote'" >/dev/null 2>&1
exit "$status"
