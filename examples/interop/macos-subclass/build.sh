#!/bin/sh
# A class defined from TypeScript, run on the lane's Mac against the same
# program written in Objective-C under ARC (`reference/subclass.m`).
#
# The arms:
#
# - **Oracle:** `reference/subclass.m`, compiled with `-fobjc-arc`, defining the
#   same class through the same runtime calls, run on the same Mac.
# - **Main (C) and LLVM:** under `--rc` the program prints exactly what the
#   oracle prints: the method is added, the class answers `respondsToSelector:`
#   and `isKindOfClass:`, Foundation calls the TypeScript closure as a method
#   (synchronously, then from the run loop as an NSTimer's target), and the
#   instance is gone once the timer lets it go. stderr is empty.
# - **Control:** under NoGc the instance outlives the timer, so the one
#   lifetime line, and only that, differs from the oracle.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# It is also the arm for a defect it found: `performSelector:withObject:` on a
# `void` method answers garbage, and retaining that result, which nothing read,
# ended the process. A borrowed result nobody reads is now not touched, as ARC
# does not touch one.
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it
# says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-subclass"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-subclass"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-subclass: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-subclass: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
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
    echo "macos-subclass: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
}
build "$out" --rc
for arch in x86_64 aarch64; do
  file -b "$out/subclass/macos-13-$arch/subclass" | grep -q "Mach-O" ||
    { echo "macos-subclass: no $arch Mach-O executable" >&2; exit 1; }
done
# The arm64 slice of the LLVM product: built and linked, and not run, since
# the lane's Mac is x86_64. Its records cross by AAPCS64, which
# `arm64-records` runs under qemu against C.
llvm_arm64="$out/subclassLlvm/macos-13-aarch64/subclassLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/subclassLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-subclass: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
echo "macos: both slices built and linked"

set -- -target x86_64-apple-macos13 -isysroot "$sdk"
clang "$@" -fuse-ld=lld -x objective-c -fobjc-arc -fblocks -Wall -Werror \
  "$source/reference/subclass.m" -framework Foundation -framework CoreFoundation -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "SKIP macos-subclass: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-subclass: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 7 ] ||
  { echo "macos-subclass: the oracle printed $(wc -l <"$out/expected.txt") lines, not 7" >&2; exit 1; }

run_quietly "$out/subclass/macos-13-x86_64/subclass" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: the TypeScript class answers and is called as clang's, stderr empty"

# LLVM: the `subclassLlvm` product, which `nts build` compiled and linked with
# the C runtime and host units, as it did the C product. Compiled from
# `program.ll`, and the `program.c` the C emission also writes never compiled.
llvm="$out/subclassLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-subclass: subclassLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/subclassLlvm" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

nogc="$out/nogc"
build "$nogc"
run_quietly "$nogc/subclass/macos-13-x86_64/subclass" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> target alive|" ]; then
  echo "macos-subclass: under NoGc the difference from the oracle was [$differs], not the lifetime line" >&2
  exit 1
fi
echo "control: under NoGc the instance outlives the timer, and nothing else differs"

