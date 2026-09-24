#!/bin/sh
# Records by value through Objective-C, run on the lane's Mac against the same
# program in Objective-C (`reference/geometry.m`).
#
# The arms:
#
# - **Oracle:** `reference/geometry.m`, compiled by clang, which decides how
#   each record is passed and which `objc_msgSend` a send goes through.
# - **Main:** the program prints exactly what the oracle prints, stderr empty.
# - **LLVM:** the same from the LLVM backend, whose `rectValue` is an
#   `sret` call to `objc_msgSend_stret` and whose `pointValue` returns
#   `{ double, double }`.
# - **Control:** the same program with every send forced through plain
#   `objc_msgSend`. On x86_64 a 32-byte `rectValue` must then go wrong, or the
#   main arm could not tell `objc_msgSend_stret` from `objc_msgSend`.
# - **arm64:** built and linked, never run here (tooling/apple/vm.md). It has no
#   `objc_msgSend_stret`, and the link proves nothing asked for one.
#
# Needs a macOS SDK. Without one it prints SKIP; with no Mac reachable it
# says the runs were not made.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-macos-geometry"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-geometry"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}

for tool in clang ld64.lld llvm-objdump llvm-nm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP macos-geometry: no $tool on PATH"
    exit 0
  fi
done
if [ ! -f "$sdk/usr/lib/libobjc.tbd" ]; then
  echo "SKIP macos-geometry: no macOS SDK at $sdk (tooling/apple/sync-sdk.sh)"
  exit 0
fi
[ -f "$apple/x86_64/lib/libuv.a" ] && [ -f "$apple/aarch64/lib/libuv.a" ] ||
  NTS_APPLE_ROOT="$apple" "$root/tooling/apple/build-libuv.sh" >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "macos-geometry: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for arch in x86_64 aarch64; do
  file -b "$out/geometry/macos-13-$arch/geometry" | grep -q "Mach-O" ||
    { echo "macos-geometry: no $arch Mach-O executable" >&2; exit 1; }
done
llvm-nm -u "$out/geometry/macos-13-x86_64/geometry" | grep -q "_objc_msgSend_stret$" ||
  { echo "macos-geometry: the x86_64 slice does not use objc_msgSend_stret" >&2; exit 1; }
if llvm-nm -u "$out/geometry/macos-13-aarch64/geometry" | grep -q "_objc_msgSend_stret$"; then
  echo "macos-geometry: the arm64 slice asks for objc_msgSend_stret, which arm64 does not have" >&2
  exit 1
fi
echo "macos: both slices built; x86_64 uses objc_msgSend_stret and arm64 does not"

set -- -target x86_64-apple-macos13 -isysroot "$sdk"
clang "$@" -fuse-ld=lld -x objective-c -fobjc-arc -Wall -Werror \
  "$source/reference/geometry.m" -framework Foundation -o "$out/oracle"

if ! "$root/tooling/apple/run.sh" --reachable; then
  echo "macos-geometry: not run -- no Mac reachable (tooling/apple/vm.md)"
  exit 0
fi
# Runs a program on the Mac into `$2.txt`, and fails on anything on stderr.
run_quietly() {
  "$root/tooling/apple/run.sh" "$1" >"$2.txt" 2>"$2.err"
  if [ -s "$2.err" ]; then
    echo "macos-geometry: $1 wrote to stderr:" >&2
    cat "$2.err" >&2
    exit 1
  fi
}
run_quietly "$out/oracle" "$out/expected"
[ "$(wc -l <"$out/expected.txt")" -eq 4 ] ||
  { echo "macos-geometry: the oracle printed $(wc -l <"$out/expected.txt") lines, not 4" >&2; exit 1; }

run_quietly "$out/geometry/macos-13-x86_64/geometry" "$out/actual"
diff -u "$out/expected.txt" "$out/actual.txt"
echo "macos-x86_64: records sent, returned and passed to C as clang passes them, stderr empty"

# LLVM, linked with the C build's runtime, main and host.
llvm="$out/llvm"
c_out="$out/geometry/macos-13-x86_64"
mkdir -p "$llvm"
"$nts" emit-llvm "$source/tsconfig.json" >"$llvm/program.ll" 2>"$llvm/emit.log" ||
  { cat "$llvm/emit.log" >&2; exit 1; }
if grep -q "NTS[0-9]" "$llvm/emit.log"; then
  cat "$llvm/emit.log" >&2
  echo "macos-geometry: emit-llvm refused part of the program" >&2
  exit 1
fi
grep -q "call void (ptr, ptr, ptr) @objc_msgSend_stret(ptr sret" "$llvm/program.ll" ||
  { echo "macos-geometry: the LLVM rectValue is not an sret call to objc_msgSend_stret" >&2; exit 1; }
clang "$@" -x ir -w -O2 -c "$llvm/program.ll" -o "$llvm/program.o"
for unit in main nts_runtime nts_uv_host nts_cf_host nts_unicode; do
  [ -f "$c_out/$unit.c" ] || continue
  clang "$@" -std=c11 -O2 -w -I"$c_out" -I"$apple/x86_64/include" -c "$c_out/$unit.c" -o "$llvm/$unit.o"
done
clang "$@" -std=c11 -O2 -w -I"$source/native" -c "$source/native/report.c" -o "$llvm/report.o"
clang "$@" -fuse-ld=lld "$llvm"/*.o -L"$apple/x86_64/lib" -luv -lobjc -framework Foundation -framework CoreFoundation \
  -o "$llvm/geometry"
run_quietly "$llvm/geometry" "$llvm/actual"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "macos-x86_64 (LLVM): the same, from the LLVM backend"

# The control: the build's own C, with the entry point decided wrongly.
c_out="$out/geometry/macos-13-x86_64"
control="$out/control"
mkdir -p "$control"
sed 's/^#define NTS_OBJC_SEND_FOR(size) ((size) > 16 ? objc_msgSend_stret : objc_msgSend)$/#define NTS_OBJC_SEND_FOR(size) objc_msgSend/' \
  "$c_out/program.c" >"$control/program.c"
if cmp -s "$c_out/program.c" "$control/program.c"; then
  echo "macos-geometry: the control changed nothing; the entry point is chosen elsewhere now" >&2
  exit 1
fi
for unit in "$control/program.c" "$c_out/main.c" "$c_out/nts_runtime.c" "$c_out/nts_uv_host.c" "$c_out/nts_cf_host.c" \
  "$c_out/nts_unicode.c" "$source/native/report.c"; do
  [ -f "$unit" ] || continue
  clang "$@" -std=c11 -O2 -w -I"$c_out" -I"$apple/x86_64/include" -I"$source/native" -c "$unit" \
    -o "$control/$(basename "$unit" .c).o"
done
clang "$@" -fuse-ld=lld "$control"/*.o -L"$apple/x86_64/lib" -luv -lobjc -framework Foundation \
  -framework CoreFoundation -o "$control/geometry"
set +e
"$root/tooling/apple/run.sh" "$control/geometry" >"$control/actual.txt" 2>&1
status=$?
set -e
if [ "$status" -eq 0 ] && cmp -s "$out/expected.txt" "$control/actual.txt"; then
  echo "macos-geometry: with objc_msgSend in place of objc_msgSend_stret the program still matched" >&2
  exit 1
fi
# And it goes wrong at the send, not before: the C function's line, which no
# send decides, is still right.
if [ "$(head -n 1 "$control/actual.txt")" != "$(head -n 1 "$out/expected.txt")" ]; then
  echo "macos-geometry: the control failed before the first send, so it measured something else:" >&2
  cat "$control/actual.txt" >&2
  exit 1
fi
echo "control: through plain objc_msgSend the 32-byte result goes wrong at the send (exit $status)"
