#!/bin/sh
# Records by value on arm64, through both backends, run under qemu's user mode
# on this machine and held to `expected.txt`.
#
# The LLVM build is the claim. AAPCS64 passes AppKit's geometry (one to four
# doubles, nested as `CGRect` is) in SIMD registers, sixteen bytes of integers
# in two general ones, and a result over sixteen bytes through `x8`, none of
# it as x86_64 does. The C build is clang's ABI by construction, so the two
# printing the same lines is the LLVM backend placing each record where C
# reads it. Spelling the four-double argument as integers instead prints
# denormals on every line that takes one.
#
# Linux and not macOS because there is no arm64 Mac here: the two conventions
# spell every shape this admits alike (`aggregate`'s module doc says where
# they differ, and that one is refused).
#
# Without qemu, zig, cmake or ninja the arm says so by name.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-arm64-records"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/arm64-records"

for tool in zig clang cmake ninja qemu-aarch64-static; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP arm64-records: no $tool on PATH"
    exit 0
  fi
done
"$root/tooling/linux/build-libuv.sh" aarch64 >/dev/null

mkdir -p "$out"
log="$out/build.log"
NTS_LINUX_ARCH=aarch64 CC="$root/tooling/linux/cc-musl.sh" "$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 ||
  { cat "$log" >&2; exit 1; }
if grep -q -E "refused and are absent|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "arm64-records: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for product in records recordsLlvm; do
  exe="$out/$product/linux-gnu-aarch64/$product"
  kind=$(file -b "$exe")
  case $kind in
    *ELF*ARM\ aarch64*statically\ linked*) ;;
    *) echo "arm64-records: $exe is not a static aarch64 ELF: $kind" >&2; exit 1 ;;
  esac
  qemu-aarch64-static "$exe" >"$out/$product.txt"
  diff -u "$source/expected.txt" "$out/$product.txt"
  echo "arm64 ($product): every record crosses as C expects it, run under qemu-aarch64"
done
