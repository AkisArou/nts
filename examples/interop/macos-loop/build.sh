#!/bin/sh
# Build the macOS program and run it four ways on the lane's Mac; see
# src/main.ts for what each line of its log means. The macOS twin of gtk-loop.
#
# - main: the order is exactly the one JavaScript's rules and a platform loop
#   together give -- an event's promise job before the next event, a job queued
#   by an event dispatched inside a task after that task -- and the timer set
#   before `CFRunLoopRun` fires during it.
# - LOOP_CONTROL=nodrain, the checkpoint after callbacks turned off: the
#   event's job waits for the next task, so the order must differ.
# - LOOP_CONTROL=detached, libuv's sources taken off the run loop: the early
#   timer cannot fire until the loop has stopped.
# - LOOP_LINGER: 1.5 s idle with nothing of libuv's alive, which must sleep.
#   `nts_uv_host_backend_timeout` answers -1 there, which arms the CF timer at
#   "never"; libuv's own answer is 0, which would spin.
#
# Needs a macOS SDK (CoreFoundation is not in zig's Darwin libc). Without one
# it prints SKIP; with no Mac reachable it says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-loop"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-loop"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-loop: no $tool on PATH"
    exit 0
  fi
done
if [ ! -d "$sdk/System/Library/Frameworks/CoreFoundation.framework" ]; then
  echo "SKIP macos-loop: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "macos-loop: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for arch in x86_64 aarch64; do
  llvm-objdump --macho --dylibs-used "$out/loop/macos-13-$arch/loop" | grep -q CoreFoundation ||
    { echo "macos-loop: the $arch program does not link CoreFoundation" >&2; exit 1; }
done
echo "macos: both slices link CoreFoundation and carry the run-loop host"

program="$out/loop/macos-13-x86_64/loop"
if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "SKIP macos-loop: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
run() {
  "$root/tooling/apple/run.sh" "$@" "$program" 2>/dev/null | tr '\n' ' ' || true
}
without_early() { printf '%s' "$1" | sed 's/early-timer //'; }
# `done` is printed once `CFRunLoopRun` has returned, so a timer logged before
# it fired while the run loop was running.
early_while_running() {
  case $1 in *early-timer*done*) return 0 ;; *) return 1 ;; esac
}
expected="event micro timeout task-start event-sync task-end micro-sync quit done "

main=$(run)
echo "main:     $main"
if [ "$(without_early "$main")" != "$expected" ] || ! early_while_running "$main"; then
  echo "FAILED macos-loop: expected $expected with early-timer before done" >&2
  exit 1
fi

nodrain=$(run --env LOOP_CONTROL=nodrain)
echo "nodrain:  $nodrain"
if [ "$(without_early "$nodrain")" = "$expected" ]; then
  echo "FAILED macos-loop: with no checkpoint after callbacks the order did not change" >&2
  exit 1
fi

detached=$(run --env LOOP_CONTROL=detached)
echo "detached: $detached"
if early_while_running "$detached"; then
  echo "FAILED macos-loop: libuv's timer fired with its sources detached, so the main arm proves nothing" >&2
  exit 1
fi

linger=$(run --env LOOP_LINGER=1500)
cpu=$(printf '%s' "$linger" | sed -n 's/.*linger-cpu-ms \([0-9]*\).*/\1/p')
echo "idle 1.5 s: ${cpu:-?} ms of CPU"
if [ -z "$cpu" ] || [ "$cpu" -ge 500 ]; then
  echo "FAILED macos-loop: ${cpu:-no measurement} ms of CPU over 1.5 s idle -- the loop is spinning" >&2
  exit 1
fi
echo "The run loop turns libuv's, promise jobs follow each callback: OK"
