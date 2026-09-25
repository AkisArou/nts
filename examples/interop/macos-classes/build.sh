#!/bin/sh
# Foundation's classes as TypeScript classes, run on the lane's Mac against the
# same program in Objective-C under ARC (`reference/classes.m`).
#
# The arms:
#
# - **Oracle:** `reference/classes.m`, compiled with `-fobjc-arc`.
# - **Main (C) and LLVM:** under `--rc` the program prints exactly what the
#   oracle prints: `new` as `alloc` and `init` (an inherited `init`, a class
#   cluster's `init` answering another object, and a class method Swift
#   imports as an `init`), methods, properties read and written, a class
#   property, and `instanceof` as `isKindOfClass:`. The object `new` made is
#   gone once nothing holds it, so its +1 was owned and given back once.
#   stderr is empty.
#   Arrays of objects own a count of each element: an overwritten one is gone
#   at once, and the array's go with it.
# - **Control:** under NoGc nothing is given back, so the three lifetime
#   lines, and only those, differ from the oracle.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it
# says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-classes"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-classes"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-classes: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-classes: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

# `build DIR [nts build flags]`.
build() {
  dir=$1
  shift
  mkdir -p "$dir"
  NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$dir" "$@" >"$dir.log" 2>&1 ||
    { cat "$dir.log" >&2; exit 1; }
  if grep -qE "refused|NTS[0-9]{4}" "$dir.log"; then
    cat "$dir.log" >&2
    echo "macos-classes: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
}
build "$out" --rc
for arch in x86_64 aarch64; do
  file -b "$out/classes/macos-13-$arch/classes" | grep -q "Mach-O" ||
    { echo "macos-classes: no $arch Mach-O executable" >&2; exit 1; }
done
# The arm64 slice of the LLVM product: built and linked, and not run, since
# the lane's Mac is x86_64. Its records cross by AAPCS64, which
# `arm64-records` runs under qemu against C.
llvm_arm64="$out/classesLlvm/macos-13-aarch64/classesLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/classesLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-classes: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
echo "macos: both slices built and linked"

set -- -target x86_64-apple-macos13 -isysroot "$sdk"
clang "$@" -fuse-ld=lld -x objective-c -fobjc-arc -Wall -Werror \
  "$source/reference/classes.m" -framework Foundation -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "macos-classes: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-classes: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 26 ] ||
  { echo "macos-classes: the oracle printed $(wc -l <"$out/expected.txt") lines, not 26" >&2; exit 1; }

run_quietly "$out/classes/macos-13-x86_64/classes" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: Foundation classes as TypeScript classes, as clang sends to them, stderr empty"

# LLVM: the `classesLlvm` product, which `nts build` compiled and linked with
# the C runtime and host units, as it did the C product.
llvm="$out/classesLlvm/macos-13-x86_64"
# The program is LLVM's: compiled from `program.ll`, and the `program.c` the C
# emission also writes (for main and the host units) never compiled.
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-classes: classesLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/classesLlvm" "$out/llvm-actual"
diff -u "$out/expected.txt" "$out/llvm-actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

nogc="$out/nogc"
build "$nogc"
run_quietly "$nogc/classes/macos-13-x86_64/classes" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> fields alive held|> replaced alive|> array alive|> object alive|" ]; then
  echo "macos-classes: under NoGc the difference from the oracle was [$differs], not the four lifetime lines" >&2
  exit 1
fi
echo "control: under NoGc the objects outlive their last use, and nothing else differs"

