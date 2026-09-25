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
# - **Off thread:** `BLOCKS_OFF_THREAD` calls a copied block on another thread
#   and releases it there, as a completion handler on a background queue is;
#   both are carried to the thread owning the closure, where its count and
#   heap are. Only a copy made off that thread still stops the process.
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
# The arm64 slice of the LLVM product: built and linked, and not run, since
# the lane's Mac is x86_64. Its records cross by AAPCS64, which
# `arm64-records` runs under qemu against C.
llvm_arm64="$out/blocksLlvm/macos-13-aarch64/blocksLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/blocksLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-blocks: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
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
[ "$(wc -l <"$out/expected.txt")" -eq 8 ] ||
  { echo "macos-blocks: the oracle printed $(wc -l <"$out/expected.txt") lines, not 8" >&2; exit 1; }

run_quietly "$out/blocks/macos-13-x86_64/blocks" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: blocks called, copied and released as clang's under ARC, stderr empty"

# LLVM: the `blocksLlvm` product, which `nts build` compiled and linked with
# the C runtime and host units, as it did the C product. Compiled from
# `program.ll`, and the `program.c` the C emission also writes never compiled.
llvm="$out/blocksLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-blocks: blocksLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/blocksLlvm" "$llvm/actual"
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

# The handler called and released on another thread: both carried to the
# owning one, in that order, and nothing written to stderr.
for product in blocks blocksLlvm; do
  "$root/tooling/apple/run.sh" --env BLOCKS_OFF_THREAD=1 "$out/$product/macos-13-x86_64/$product" \
    >"$out/$product-off.txt" 2>"$out/$product-off.err" ||
    { cat "$out/$product-off.txt" "$out/$product-off.err" >&2; exit 1; }
  [ -s "$out/$product-off.err" ] && { cat "$out/$product-off.err" >&2; exit 1; }
  grep '^off thread' "$out/$product-off.txt" >"$out/$product-off.lines"
  printf '%s\n' "off thread: called and released" "off thread: called on the main thread true with 7 same" \
    "off thread: resolved an object on the main thread true" \
    'off thread: rejected with "the item was not there"' \
    "off thread: a pair of two objects" \
    "off thread: closure gone" | diff -u - "$out/$product-off.lines"
done
echo "off thread: a handler called and released on another thread runs and is released on this one, on both backends"

# A console program awaiting a completion from another thread, with no run
# loop: the awaited operation keeps it alive (`c:pending`) until the handler,
# on both backends. The control drops the bracket and ends first.
for product in blocks blocksLlvm; do
  "$root/tooling/apple/run.sh" --env BLOCKS_CONSOLE=held "$out/$product/macos-13-x86_64/$product" \
    >"$out/$product-console.txt" 2>"$out/$product-console.err" ||
    { cat "$out/$product-console.txt" "$out/$product-console.err" >&2; exit 1; }
  [ -s "$out/$product-console.err" ] && { cat "$out/$product-console.err" >&2; exit 1; }
  [ "$(cat "$out/$product-console.txt")" = "console: resolved an object on the main thread true" ] ||
    { echo "macos-blocks: $product's console program printed [$(cat "$out/$product-console.txt")]" >&2; exit 1; }
  "$root/tooling/apple/run.sh" --env BLOCKS_CONSOLE=unheld "$out/$product/macos-13-x86_64/$product" \
    >"$out/$product-unheld.txt" 2>"$out/$product-unheld.err" || true
  if grep -q "^console:" "$out/$product-unheld.txt"; then
    echo "macos-blocks: without the bracket $product still waited for the completion" >&2
    exit 1
  fi
done
echo "console: an awaited completion from another thread keeps a program with no run loop alive, and without it the program ends first"
