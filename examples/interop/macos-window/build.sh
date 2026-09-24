#!/bin/sh
# A window, a button, and a TypeScript closure as the button's action, run
# inside `[NSApp run]` on the lane's Mac, in its GUI session. See src/main.ts.
#
# The arms:
#
# - **Main:** exactly the order JavaScript gives. Each press, then its promise
#   job, then its timeout, before the application stops. The press arrives
#   through `performClick:`, which turns a nested run loop while the timer's
#   callback is still running, and no task may start there. Before the CF host
#   checked for that, `timeout 1` came before `micro 1`, and this arm
#   rejects that order.
# - **Control:** `WINDOW_CONTROL=detached` takes libuv's sources off the run
#   loop. The presses and the stop are Cocoa's own and still happen, but no
#   timeout may fire before the application has stopped.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it
# says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-window"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-window"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-window: no $tool on PATH"
    exit 0
  fi
done
if [ ! -d "$sdk/System/Library/Frameworks/AppKit.framework" ]; then
  echo "SKIP macos-window: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -q "refused" "$log"; then
  cat "$log" >&2
  echo "macos-window: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for arch in x86_64 aarch64; do
  llvm-objdump --macho --dylibs-used "$out/window/macos-13-$arch/window" | grep -q AppKit ||
    { echo "macos-window: the $arch program does not link AppKit" >&2; exit 1; }
done
echo "macos: both slices link AppKit"

program="$out/window/macos-13-x86_64/window"
if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "macos-window: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs the program on the Mac, bounded: a window whose loop never stops would
# otherwise hold the gate.
run() {
  timeout 60 "$root/tooling/apple/run.sh" "$@" "$program"
}

run >"$out/main.txt" 2>"$out/main.err" || { cat "$out/main.txt" "$out/main.err" >&2; exit 1; }
if [ -s "$out/main.err" ]; then
  echo "macos-window: the program wrote to stderr:" >&2
  cat "$out/main.err" >&2
  exit 1
fi
cat >"$out/expected.txt" <<'EXPECTED'
window 320 button 100x32
pressed 1
micro 1
timeout 1
pressed 2
micro 2
timeout 2
stopped
done
EXPECTED
diff -u "$out/expected.txt" "$out/main.txt"
echo "main: a closure as a button's action, its job and its timeout run inside [NSApp run], in order"

run --env WINDOW_CONTROL=detached >"$out/control.txt" 2>&1 || { cat "$out/control.txt" >&2; exit 1; }
before=$(sed -n '1,/^stopped$/p' "$out/control.txt")
case $before in
  *stopped*) ;;
  *) echo "macos-window: the detached control never stopped:" >&2; cat "$out/control.txt" >&2; exit 1 ;;
esac
case $before in
  *timeout*)
    echo "macos-window: a timeout fired with libuv detached, so the main arm proves nothing:" >&2
    cat "$out/control.txt" >&2
    exit 1 ;;
esac
grep -q "^pressed 2$" "$out/control.txt" ||
  { echo "macos-window: the detached control did not press twice" >&2; exit 1; }
echo "control: with libuv detached the presses still happen and no timeout fires before the stop"
