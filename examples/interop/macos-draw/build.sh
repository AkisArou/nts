#!/bin/sh
# Core Graphics from TypeScript, as Swift imports it, run on the lane's Mac
# against the same drawing in C (`reference/draw.c`).
#
# The arms:
#
# - **Binding:** `types/coregraphics.d.ts` is `nts bind-objc`'s, regenerated
#   and compared: `CGContext`, `CGColor` and `CGColorSpace` as the classes
#   Swift makes of them, their methods the C functions Swift makes members.
# - **Oracle:** `reference/draw.c`, compiled with the SDK's headers and run on
#   the same Mac.
# - **Main (C) and LLVM:** under `--rc` the program prints exactly what the
#   oracle prints: every pixel of the drawing, a colour's property, and the
#   colours released once nothing holds them. stderr is empty.
# - **Control:** under NoGc the colour outlives its last use, so the one
#   lifetime line, and only that, differs from the oracle.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it
# says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-draw"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-draw"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-draw: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-draw: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
# `types/coregraphics.d.ts` is `nts bind-objc`'s, and must still be:
# regenerated and compared. NTS_REGENERATE=1 writes it instead.
"$nts" bind-objc --sdk "$sdk" --module objc:CoreGraphics --framework CoreGraphics \
  --class CGContext --class CGColor --class CGColorSpace --function CGColorSpaceCreateDeviceRGB \
  --out "$out/coregraphics.d.ts" >/dev/null
if [ "${NTS_REGENERATE:-}" = 1 ]; then
  command cp -f "$out/coregraphics.d.ts" "$source/types/coregraphics.d.ts"
fi
diff -u "$source/types/coregraphics.d.ts" "$out/coregraphics.d.ts" >"$out/coregraphics.d.ts.diff" || {
  head -40 "$out/coregraphics.d.ts.diff" >&2
  echo "macos-draw: types/coregraphics.d.ts is not what nts bind-objc writes; NTS_REGENERATE=1 rewrites it" >&2
  exit 1
}
echo "bind-objc: types/coregraphics.d.ts is the generator's, unchanged"

# `build DIR [nts build flags]`.
build() {
  dir=$1
  shift
  mkdir -p "$dir"
  NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$dir" "$@" >"$dir.log" 2>&1 ||
    { cat "$dir.log" >&2; exit 1; }
  if grep -qE "refused|NTS[0-9]{4}" "$dir.log"; then
    cat "$dir.log" >&2
    echo "macos-draw: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
}
build "$out" --rc
for arch in x86_64 aarch64; do
  file -b "$out/draw/macos-13-$arch/draw" | grep -q "Mach-O" ||
    { echo "macos-draw: no $arch Mach-O executable" >&2; exit 1; }
done
llvm_arm64="$out/drawLlvm/macos-13-aarch64/drawLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/drawLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-draw: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
echo "macos: both slices built and linked"

clang -target x86_64-apple-macos13 -isysroot "$sdk" -fuse-ld=lld -Wall -Werror \
  "$source/reference/draw.c" -framework CoreGraphics -lobjc -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "macos-draw: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-draw: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 7 ] ||
  { echo "macos-draw: the oracle printed $(wc -l <"$out/expected.txt") lines, not 7" >&2; exit 1; }

run_quietly "$out/draw/macos-13-x86_64/draw" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: every pixel as C draws it, and the colours released, stderr empty"

llvm="$out/drawLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-draw: drawLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/drawLlvm" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

nogc="$out/nogc"
build "$nogc"
run_quietly "$nogc/draw/macos-13-x86_64/draw" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> color alive|" ]; then
  echo "macos-draw: under NoGc the difference from the oracle was [$differs], not the lifetime line" >&2
  exit 1
fi
echo "control: under NoGc the colour outlives its last use, and nothing else differs"
