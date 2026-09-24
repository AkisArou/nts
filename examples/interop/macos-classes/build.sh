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
# - **Control:** under NoGc that object outlives its last use, so the one
#   lifetime line, and only that, differs from the oracle.
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
  if grep -q "refused" "$dir.log"; then
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
[ "$(wc -l <"$out/expected.txt")" -eq 11 ] ||
  { echo "macos-classes: the oracle printed $(wc -l <"$out/expected.txt") lines, not 11" >&2; exit 1; }

run_quietly "$out/classes/macos-13-x86_64/classes" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: Foundation classes as TypeScript classes, as clang sends to them, stderr empty"

# LLVM, linked with the C build's runtime, main and shim.
llvm="$out/llvm"
c_out="$out/classes/macos-13-x86_64"
mkdir -p "$llvm"
"$nts" emit-llvm "$source/tsconfig.json" --rc >"$llvm/program.ll" 2>"$llvm/emit.log" ||
  { cat "$llvm/emit.log" >&2; exit 1; }
if grep -q "NTS[0-9]" "$llvm/emit.log"; then
  cat "$llvm/emit.log" >&2
  echo "macos-classes: emit-llvm refused part of the program" >&2
  exit 1
fi
clang "$@" -x ir -w -O2 -c "$llvm/program.ll" -o "$llvm/program.o"
for unit in main nts_runtime nts_uv_host nts_cf_host nts_unicode; do
  [ -f "$c_out/$unit.c" ] || continue
  clang "$@" -std=c11 -O2 -w -DNTS_PROVIDER_RC -I"$c_out" -I"$apple/x86_64/include" -c "$c_out/$unit.c" -o "$llvm/$unit.o"
done
clang "$@" -std=c11 -O2 -w -I"$c_out" -c "$source/native/support.c" -o "$llvm/support.o"
clang "$@" -fuse-ld=lld "$llvm"/*.o -L"$apple/x86_64/lib" -luv -lobjc -framework Foundation -framework CoreFoundation \
  -o "$llvm/classes"
run_quietly "$llvm/classes" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

nogc="$out/nogc"
build "$nogc"
run_quietly "$nogc/classes/macos-13-x86_64/classes" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> object alive|" ]; then
  echo "macos-classes: under NoGc the difference from the oracle was [$differs], not the lifetime line" >&2
  exit 1
fi
echo "control: under NoGc the object new made outlives its last use, and nothing else differs"

