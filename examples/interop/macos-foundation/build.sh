#!/bin/sh
# Foundation from TypeScript: the program's Objective-C messages and the
# lifetime of every object it holds, run on a Mac and compared with the same
# messages sent from hand-written C.
#
# The arms:
#
# - **Oracle:** `reference/foundation.c` is compiled against the same SDK and
#   run on the same Mac. It releases each object exactly where ARC would. Both
#   programs call Apple's Foundation, so the expectation is the library's
#   answer, not a second implementation's.
# - **Main:** the program built with `--rc` for macos-13 x86_64 prints exactly
#   what the oracle prints, including the four lines that say an object died
#   where its last TypeScript reference did: a local, an `init` result, a
#   field of a heap object, and a closure's capture (observed with zeroing
#   weak references, not `retainCount`).
# - **LLVM:** the same program from the LLVM backend, also under `--rc`.
# - **Control:** the same program under NoGc (no provider flag) differs from
#   the oracle in exactly those four lines. There the objects outlive their
#   owners, so the lifetime lines can fail and the rest cannot.
# - **Pool:** stderr is empty on every run. A +0 result autoreleased with no
#   pool in place leaks and says so there, which no stdout comparison sees.
# - **Comparison:** a changed expectation is rejected.
# - **arm64:** built, linked against libobjc and Foundation, and inspected.
#   Never run here: the lane's Mac is x86_64 (tooling/apple/vm.md).
#
# It needs a real SDK (`NTS_APPLE_SDK`), because libobjc and Foundation are
# not in zig's Darwin libc. Without one, or without the tools, it prints SKIP.
# With no Mac reachable, the run arms say so by name and the rest still count.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-foundation"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-foundation"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-foundation: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-foundation: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" --rc >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "macos-foundation: nts build refused part of the program and exited 0" >&2
  exit 1
fi

for arch in x86_64 aarch64; do
  program="$out/foundation/macos-13-$arch/foundation"
  case $arch in x86_64) cpu=x86_64 ;; aarch64) cpu=arm64 ;; esac
  kind=$(file -b "$program")
  case $kind in
    *Mach-O*"$cpu"*executable*) ;;
    *) echo "macos-foundation: $program is not a $cpu Mach-O executable: $kind" >&2; exit 1 ;;
  esac
  loads=$(llvm-objdump --macho --dylibs-used "$program" | tail -n +2 | awk '{print $1}' | LC_ALL=C sort | tr '\n' ' ')
  # CoreFoundation is the run-loop host's (`nts_cf_host`), which every
  # macOS program that sends messages gets.
  want="/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation /System/Library/Frameworks/Foundation.framework/Versions/C/Foundation /usr/lib/libSystem.B.dylib /usr/lib/libobjc.A.dylib "
  if [ "$loads" != "$want" ]; then
    echo "macos-foundation: $arch loads [$loads], expected [$want]" >&2
    exit 1
  fi
  echo "macos-$arch: Mach-O $cpu, libobjc + Foundation + CoreFoundation + libSystem"
done

clang -target x86_64-apple-macos13 -isysroot "$sdk" -fuse-ld=lld -std=c11 -Wall -Wextra -Werror \
  "$source/reference/foundation.c" -lobjc -framework Foundation -o "$out/reference"

set +e
"$root/tooling/apple/run.sh" "$out/reference" >"$out/expected.txt"
status=$?
set -e
case $status in
  0) ;;
  77) echo "macos-x86_64: not run -- no Mac reachable (tooling/apple/vm.md)"; exit 0 ;;
  *) echo "macos-foundation: the C oracle exited $status on the Mac" >&2; exit 1 ;;
esac
# An oracle that printed nothing would make every comparison below vacuous.
[ "$(wc -l <"$out/expected.txt")" -eq 14 ] ||
  { echo "macos-foundation: the oracle printed $(wc -l <"$out/expected.txt") lines, not 14" >&2; exit 1; }

# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-foundation: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}

run_quietly "$out/foundation/macos-13-x86_64/foundation" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: messages and lifetimes answer as the C oracle's, run on a Mac, stderr empty"

# The control: one variable, the provider.
nogc="$out/nogc"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$nogc" >"$nogc.log" 2>&1 ||
  { cat "$nogc.log" >&2; exit 1; }
run_quietly "$nogc/foundation/macos-13-x86_64/foundation" "$out/nogc-actual"
differs=$(diff "$out/expected.txt" "$out/nogc-actual.txt" | grep '^>' | tr '\n' '|')
if [ "$differs" != "> scoped new alive|> scoped init alive|> in a field alive|> captured alive|" ]; then
  echo "macos-foundation: under NoGc the difference from the oracle was [$differs], not the four lifetime lines" >&2
  exit 1
fi
echo "control: under NoGc the four released objects outlive their owners, and nothing else differs"

# **The LLVM backend, same program, same oracle.** `nts build` drives the C
# backend only, so this links `emit-llvm`'s IR with the C build's `main.c`,
# runtime and shim, which is how the gate's LLVM steps build too.
llvm="$out/llvm"
c_out="$out/foundation/macos-13-x86_64"
mkdir -p "$llvm"
"$nts" emit-llvm "$source/tsconfig.json" --rc >"$llvm/program.ll" 2>"$llvm/emit.log" ||
  { cat "$llvm/emit.log" >&2; exit 1; }
if grep -q "NTS[0-9]" "$llvm/emit.log"; then
  cat "$llvm/emit.log" >&2
  echo "macos-foundation: emit-llvm refused part of the program" >&2
  exit 1
fi
set -- -target x86_64-apple-macos13 -isysroot "$sdk"
clang "$@" -x ir -w -O2 -c "$llvm/program.ll" -o "$llvm/program.o"
for unit in main nts_runtime nts_uv_host nts_cf_host nts_unicode; do
  [ -f "$c_out/$unit.c" ] || continue
  clang "$@" -std=c11 -O2 -w -DNTS_PROVIDER_RC -I"$c_out" -I"$apple/x86_64/include" -c "$c_out/$unit.c" -o "$llvm/$unit.o"
done
clang "$@" -std=c11 -O2 -w -c "$source/native/report.c" -o "$llvm/report.o"
clang "$@" -fuse-ld=lld "$llvm"/*.o -L"$apple/x86_64/lib" -luv -lobjc -framework Foundation -framework CoreFoundation -o "$llvm/foundation"
run_quietly "$llvm/foundation" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend under --rc"

sed 's/^count 2$/count 3/' "$out/expected.txt" >"$out/control.txt"
if diff -q "$out/control.txt" "$out/actual.txt" >/dev/null; then
  echo "macos-foundation: the comparison accepted a changed expectation" >&2
  exit 1
fi
echo "control: a changed expectation is rejected"
