#!/bin/sh
# Build the GTK program and run it four ways; see src/main.ts for what each
# line of its log means.
#
# - main: the order is exactly the one that JavaScript's rules and GJS's loop
#   together give -- a click's promise job before the next event, a job queued
#   by a click emitted inside a task after that task -- and the timer set
#   before `g_application_run` fires during it.
# - LOOP_CONTROL=nodrain, the checkpoint after callbacks turned off: the
#   click's job waits for the next task, so the order must differ.
# - LOOP_CONTROL=detached, libuv's source taken off GLib's loop: the early
#   timer cannot fire until the application has quit.
# - LOOP_LINGER: 1.5 s idle with nothing of libuv's alive, which must sleep.
#   Before the fix this measures, `uv_backend_timeout` answered 0 for a loop
#   with nothing alive, the source spun at default priority -- 200 CPU ticks
#   in 2 s -- and starved GLib's idle sources so the click never came.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-loop"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-loop"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-loop: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-loop: no Xvfb on PATH"
  exit 0
fi

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out"
program="$out/loop/linux-gnu-x86_64/loop"

run() {
  env GSK_RENDERER=cairo G_DEBUG=fatal-criticals "$@" \
    timeout 30 "$root/examples/interop/with-display.sh" "$program" 2>/dev/null | tr '\n' ' ' || true
}
without_early() { printf '%s' "$1" | sed 's/early-timer //'; }
# `done` is printed once `g_application_run` has returned, so a timer logged
# before it fired while GLib's loop was running.
early_while_running() {
  case $1 in *early-timer*done*) return 0 ;; *) return 1 ;; esac
}

expected="click micro timeout task-start click-sync task-end micro-sync nested spun micro-nested timeout-nested quit done "
main=$(run)
echo "main:     $main"
if [ "$(without_early "$main")" != "$expected" ] || ! early_while_running "$main"; then
  echo "FAILED gtk-loop: expected $expected with early-timer before done" >&2
  exit 1
fi

nodrain=$(run LOOP_CONTROL=nodrain)
echo "nodrain:  $nodrain"
if [ "$(without_early "$nodrain")" = "$expected" ]; then
  echo "FAILED gtk-loop: with no checkpoint after callbacks the order did not change" >&2
  exit 1
fi

detached=$(run LOOP_CONTROL=detached)
echo "detached: $detached"
if early_while_running "$detached"; then
  echo "FAILED gtk-loop: libuv's timer fired with its source detached, so the main arm proves nothing" >&2
  exit 1
fi

cpu=$(env GSK_RENDERER=cairo LOOP_LINGER=1500 timeout 30 "$root/examples/interop/with-display.sh" \
  /usr/bin/time -f "%U %S" "$program" 2>&1 >/dev/null | tail -1)
echo "idle 1.5 s, cpu (user sys): $cpu"
if ! printf '%s' "$cpu" | awk '{ exit !($1 + $2 < 0.5) }'; then
  echo "FAILED gtk-loop: $cpu s of CPU over 1.5 s idle -- the loop is spinning" >&2
  exit 1
fi
echo "GTK's loop turns libuv's, promise jobs follow each callback: OK"
