#!/bin/sh
# One program for arm64 Linux through both backends, run under qemu's user
# mode on this machine, and held to what node prints for it (`expected.txt`).
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing, with `CC` set to
#   `tooling/linux/cc-musl.sh` for aarch64: static, against musl, with the
#   libuv `tooling/linux/build-libuv.sh` cross-builds.
# - **The artifact:** a statically linked ARM aarch64 ELF executable.
# - **The run:** each build prints `expected.txt` under `qemu-aarch64-static`.
#   The LLVM build is the claim: AAPCS64 passes an erased value as two words
#   and an awaited promise's task as a pointer to a copy, which System V
#   spells differently, and before either was right this program printed the
#   wrong thing or nothing.
#
# Without qemu, zig, cmake or ninja the arms say so by name.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-linux-arm64"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/linux-arm64"

for tool in zig clang cmake ninja qemu-aarch64-static; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP linux-arm64: no $tool on PATH"
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
  echo "linux-arm64: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for product in arm64 arm64Llvm; do
  exe="$out/$product/linux-gnu-aarch64/$product"
  kind=$(file -b "$exe")
  case $kind in
    *ELF*ARM\ aarch64*statically\ linked*) ;;
    *) echo "linux-arm64: $exe is not a static aarch64 ELF: $kind" >&2; exit 1 ;;
  esac
  qemu-aarch64-static "$exe" >"$out/$product.txt"
  diff -u "$source/expected.txt" "$out/$product.txt"
  echo "linux-aarch64 ($product): matches node, run under qemu-aarch64"
done
