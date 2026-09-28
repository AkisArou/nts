#!/bin/sh
# A project's own Objective-C from TypeScript: `native/Greeter.h` and
# `native/Greeter.m`, which the program imports as `objc:Greeter`. Run on the
# lane's Mac against the same program in Objective-C (`reference/main.m`).
#
# The arms:
#
# - **Binding:** none is committed. `nts build` reads the header, extracts
#   Swift's names for it with the Swift toolchain on this machine
#   (`tooling/cli/src/swift.rs`), and binds it with them; `Greeter.m`
#   compiles under ARC beside the program. The build log must say nothing was
#   refused.
# - **Oracle:** `reference/main.m`, compiled with the same `Greeter.m` under
#   ARC and run on the same Mac.
# - **Main (C) and LLVM:** under `--rc` the program prints exactly what the
#   oracle prints: an initializer with labels, a method, a property written and
#   read, a class method, a TypeScript class adopting the header's protocol
#   called back through its required and its optional method, the `async` form
#   of a completion handler completed on another thread -- with a number,
#   and with a string the block is given -- and the Greeter
#   released once the program drops it. stderr is empty.
# - **Control:** under NoGc the Greeter outlives its last use, so the one
#   lifetime line, and only that, differs from the oracle.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md).
#
# Needs a macOS SDK and a Swift toolchain (swift.rs says which). Without
# either it prints SKIP; with no Mac reachable it says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-native-objc"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-native-objc"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-native-objc: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-native-objc: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
swift=${NTS_SWIFT_TOOLCHAIN:-$(ls -d "$HOME"/.cache/nts/swift/swift-*/ 2>/dev/null | sort | tail -1)}
if [ -z "$swift" ] || [ ! -x "$swift/usr/bin/swift-symbolgraph-extract" ]; then
  echo "SKIP macos-native-objc: no Swift toolchain (NTS_SWIFT_TOOLCHAIN, or one unpacked under ~/.cache/nts/swift)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

# `build DIR [nts build flags]`.
build() {
  dir=$1
  shift
  mkdir -p "$dir"
  NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" NTS_SWIFT_TOOLCHAIN="$swift" "$nts" build "$source/tsconfig.json" --out "$dir" "$@" >"$dir.log" 2>&1 ||
    { cat "$dir.log" >&2; exit 1; }
  if grep -qE "refused|NTS[0-9]{4}" "$dir.log"; then
    cat "$dir.log" >&2
    echo "macos-native-objc: nts build refused part of the program and exited 0" >&2
    exit 1
  fi
}
build "$out" --rc
for arch in x86_64 aarch64; do
  file -b "$out/greeter/macos-13-$arch/greeter" | grep -q "Mach-O" ||
    { echo "macos-native-objc: no $arch Mach-O executable" >&2; exit 1; }
  [ -f "$out/greeter/macos-13-$arch/Greeter.m.o" ] ||
    { echo "macos-native-objc: Greeter.m was not compiled for $arch" >&2; exit 1; }
done
llvm_arm64="$out/greeterLlvm/macos-13-aarch64/greeterLlvm"
file -b "$llvm_arm64" | grep -q "Mach-O.*arm64" && [ -f "$out/greeterLlvm/macos-13-aarch64/program.ll.o" ] ||
  { echo "macos-native-objc: no arm64 Mach-O compiled from LLVM IR at $llvm_arm64" >&2; exit 1; }
echo "macos: both slices built and linked, Greeter.m compiled in each"

clang -target x86_64-apple-macos13 -isysroot "$sdk" -fuse-ld=lld -x objective-c -fobjc-arc -fblocks -Wall -Werror \
  -I "$source/native" "$source/reference/main.m" "$source/native/Greeter.m" -framework Foundation -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "SKIP macos-native-objc: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-native-objc: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 13 ] ||
  { echo "macos-native-objc: the oracle printed $(wc -l <"$out/expected.txt") lines, not 13" >&2; exit 1; }

run_quietly "$out/greeter/macos-13-x86_64/greeter" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: the project's class, protocol and completion handler as Objective-C has them, stderr empty"

llvm="$out/greeterLlvm/macos-13-x86_64"
[ -f "$llvm/program.ll.o" ] && [ ! -f "$llvm/program.c.o" ] ||
  { echo "macos-native-objc: greeterLlvm was not compiled from LLVM IR" >&2; exit 1; }
run_quietly "$llvm/greeterLlvm" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

nogc="$out/nogc"
build "$nogc"
run_quietly "$nogc/greeter/macos-13-x86_64/greeter" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> greeter alive|" ]; then
  echo "macos-native-objc: under NoGc the difference from the oracle was [$differs], not the lifetime line" >&2
  exit 1
fi
echo "control: under NoGc the Greeter outlives its last use, and nothing else differs"
