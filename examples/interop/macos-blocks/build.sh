#!/bin/sh
# TypeScript closures as Objective-C blocks, run on the lane's Mac against the
# same program written in Objective-C under ARC (`reference/blocks.m`).
#
# The arms:
#
# - **Oracle:** `reference/blocks.m`, compiled with `-fobjc-arc`, so clang
#   decides every block copy and release, run on the same Mac.
# - **Main (C) and LLVM:** the program under `--rc` prints exactly what the
#   oracle prints: a block called during the call sees and changes captured
#   variables, a repeating timer's copy fires from the run loop, and the
#   closures of an invalidated timer and a never-fired one are gone once the
#   block runtime lets go of them. stderr is empty.
# - **Control:** under NoGc the two closures outlive their blocks, so the two
#   lifetime lines, and only those, differ from the oracle.
# - **Guard:** `BLOCKS_OFF_THREAD` releases a copied block on another thread.
#   Its dispose would touch the closure's count off the owning thread, so the
#   process must stop, naming why. A block's copy and dispose run without the
#   block being called, so the guard is in those helpers.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it
# says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-blocks"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-blocks"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-blocks: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-blocks: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
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
    echo "macos-blocks: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
}
build "$out" --rc
for arch in x86_64 aarch64; do
  file -b "$out/blocks/macos-13-$arch/blocks" | grep -q "Mach-O" ||
    { echo "macos-blocks: no $arch Mach-O executable" >&2; exit 1; }
done
echo "macos: both slices built and linked"

set -- -target x86_64-apple-macos13 -isysroot "$sdk"
clang "$@" -fuse-ld=lld -x objective-c -fobjc-arc -fblocks -Wall -Werror \
  "$source/reference/blocks.m" -framework Foundation -framework CoreFoundation -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "macos-blocks: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-blocks: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 7 ] ||
  { echo "macos-blocks: the oracle printed $(wc -l <"$out/expected.txt") lines, not 7" >&2; exit 1; }

run_quietly "$out/blocks/macos-13-x86_64/blocks" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: blocks called, copied and released as clang's under ARC, stderr empty"

# LLVM, linked with the C build's runtime, main and shim.
llvm="$out/llvm"
c_out="$out/blocks/macos-13-x86_64"
mkdir -p "$llvm"
"$nts" emit-llvm "$source/tsconfig.json" --rc >"$llvm/program.ll" 2>"$llvm/emit.log" ||
  { cat "$llvm/emit.log" >&2; exit 1; }
if grep -q "NTS[0-9]" "$llvm/emit.log"; then
  cat "$llvm/emit.log" >&2
  echo "macos-blocks: emit-llvm refused part of the program" >&2
  exit 1
fi
clang "$@" -x ir -w -O2 -c "$llvm/program.ll" -o "$llvm/program.o"
for unit in main nts_runtime nts_uv_host nts_cf_host nts_unicode; do
  [ -f "$c_out/$unit.c" ] || continue
  clang "$@" -std=c11 -O2 -w -DNTS_PROVIDER_RC -I"$c_out" -I"$apple/x86_64/include" -c "$c_out/$unit.c" -o "$llvm/$unit.o"
done
clang "$@" -std=c11 -O2 -w -I"$c_out" -c "$source/native/support.c" -o "$llvm/support.o"
clang "$@" -fuse-ld=lld "$llvm"/*.o -L"$apple/x86_64/lib" -luv -lobjc -framework Foundation -framework CoreFoundation \
  -o "$llvm/blocks"
run_quietly "$llvm/blocks" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

nogc="$out/nogc"
build "$nogc"
run_quietly "$nogc/blocks/macos-13-x86_64/blocks" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> cancelled alive|> ticking alive|" ]; then
  echo "macos-blocks: under NoGc the difference from the oracle was [$differs], not the two lifetime lines" >&2
  exit 1
fi
echo "control: under NoGc both closures outlive their blocks, and nothing else differs"

set +e
guard=$("$root/tooling/apple/run.sh" --env BLOCKS_OFF_THREAD=1 "$out/blocks/macos-13-x86_64/blocks" 2>&1)
status=$?
set -e
case $guard in
  *"nts: a block was released off the thread that owns its closure"*) ;;
  *) echo "macos-blocks: a block released off its thread did not stop the process by name:" >&2
     printf '%s\n' "$guard" >&2
     exit 1 ;;
esac
[ "$status" -ne 0 ] || { echo "macos-blocks: the off-thread release exited 0" >&2; exit 1; }
echo "guard: a block released off the owning thread stops the process, by name"
