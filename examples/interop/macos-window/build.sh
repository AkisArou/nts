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
# - **Nested:** `WINDOW_NESTED=1` makes the first press's handler, still inside
#   its callback, make libuv's kqueue readable and turn a nested run loop for a
#   second. The host must neither run a task there nor spin: before it parked
#   the descriptor, that second cost a second of CPU.
# - **LLVM:** the main arm's program from the LLVM backend, the same order.
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
version=$(sed -n 's/.*"Version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sdk/SDKSettings.json" | head -1)
if [ ! -f "$apple/symbolgraph/$version/AppKit.symbols.json" ]; then
  echo "SKIP macos-window: no Swift symbol graphs for SDK $version (tooling/apple/symbolgraph.sh AppKit Foundation ObjectiveC)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
# `types/appkit.d.ts` is `nts bind-objc`'s, and must still be: regenerated
# and compared, so a generator change or an SDK update is a diff here rather
# than a program that quietly compiles against something else.
# NTS_REGENERATE=1 writes it instead.
"$nts" bind-objc --sdk "$sdk" --module objc:AppKit --framework AppKit --framework Foundation \
  --class NSApplication --class NSWindow --class NSButton --class NSString --class NSTimer --class NSEvent \
  --protocol NSWindowDelegate --out "$out/appkit.d.ts" --witness "$out/witness.c" >/dev/null
if [ "${NTS_REGENERATE:-}" = 1 ]; then
  command cp -f "$out/appkit.d.ts" "$source/types/appkit.d.ts"
fi
diff -u "$source/types/appkit.d.ts" "$out/appkit.d.ts" >"$out/appkit.diff" || {
  head -40 "$out/appkit.diff" >&2
  echo "macos-window: types/appkit.d.ts is not what nts bind-objc writes; NTS_REGENERATE=1 rewrites it" >&2
  exit 1
}
echo "bind-objc: types/appkit.d.ts is the generator's, unchanged"
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
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
# The witness: every message the binding sends, asked of the Mac's runtime.
# What it lacks is `witness.expected`, each line explained there; a change
# either way is a binding that sends something new the runtime lacks, or a
# baseline gone stale.
clang -target x86_64-apple-macos13 -isysroot "$sdk" -fuse-ld=lld -framework AppKit -framework Foundation -lobjc -w \
  "$out/witness.c" -o "$out/witness"
timeout 60 "$root/tooling/apple/run.sh" "$out/witness" >"$out/witness.txt" 2>&1 || true
grep -v '^#' "$source/witness.expected" | diff -u - "$out/witness.txt" ||
  { echo "macos-window: the runtime's answer to the binding's messages changed (witness.expected)" >&2; exit 1; }
echo "witness: $(tail -1 "$out/witness.txt")"

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
window 320 button 100x32 views 1
pressed 1
micro 1
timeout 1
pressed 2
micro 2
timeout 2
stopped
closing
done
EXPECTED
diff -u "$out/expected.txt" "$out/main.txt"
echo "main: a class's method as a button's action and a window's delegate, its job and its timeout inside [NSApp run], in order"

run --env WINDOW_NESTED=1 >"$out/nested.txt" 2>"$out/nested.err" || { cat "$out/nested.txt" "$out/nested.err" >&2; exit 1; }
cpu=$(sed -n 's/^nested-cpu-ms \([0-9]*\)$/\1/p' "$out/nested.txt")
if [ -z "$cpu" ] || [ "$cpu" -ge 300 ]; then
  echo "macos-window: a nested loop under a callback took ${cpu:-no measurement} ms of CPU in one second -- the host spins" >&2
  cat "$out/nested.txt" >&2
  exit 1
fi
# Nothing ran inside the callback: its job is the next thing after it. After
# the second, libuv's timer and Cocoa's are both overdue, and which of two
# run-loop timers fires first is not defined, so the rest is compared as a set.
inside=$(sed -n '/^pressed 1$/,/^micro 1$/p' "$out/nested.txt" | grep -v '^pressed 1$\|^micro 1$\|^nested-cpu-ms ' || true)
if [ -n "$inside" ]; then
  echo "macos-window: a task ran inside the callback's nested loop: $inside" >&2
  exit 1
fi
grep -v '^nested-cpu-ms ' "$out/nested.txt" | LC_ALL=C sort >"$out/nested.sorted"
LC_ALL=C sort "$out/expected.txt" | diff -u - "$out/nested.sorted"
echo "nested: a second-long loop inside a callback, kqueue readable, ran no task and took ${cpu} ms of CPU"

# LLVM: the `windowLlvm` product, which `nts build` compiled and linked with
# the C runtime and host units, as it did the C product. Compiled from
# `program.ll`, and the `program.c` the C emission also writes never compiled.
llvm="$out/windowLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-window: windowLlvm was not compiled from LLVM IR" >&2; exit 1; }
timeout 60 "$root/tooling/apple/run.sh" "$llvm/windowLlvm" >"$llvm/main.txt" 2>"$llvm/main.err" ||
  { cat "$llvm/main.txt" "$llvm/main.err" >&2; exit 1; }
[ -s "$llvm/main.err" ] && { cat "$llvm/main.err" >&2; exit 1; }
diff -u "$out/expected.txt" "$llvm/main.txt"
echo "LLVM: the same window, from the LLVM backend"

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
