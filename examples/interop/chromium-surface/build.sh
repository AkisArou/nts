#!/bin/sh
# A program for Chromium's renderer, built as the Chromium lane's app host
# links it, through both backends. Running it needs Chromium; this is the half
# that does not.
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing, for a project whose
#   tsconfig.json names only its own files: the DOM surface reached the
#   program from `target.chromium()` (a missing one is NTS refusals by the
#   dozen, every lib.dom use unbound).
# - **The native half:** each archive holds the DOM ABI's own object,
#   `abi_check.c.o`, which only the target's `native` directory contributes.
# - **The binding:** the program calls `nts:dom`'s C functions, the ones
#   lib.dom delegates to.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-chromium-surface"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/chromium-surface"

for tool in clang llvm-ar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP chromium-surface: no $tool on PATH"
    exit 0
  fi
done

mkdir -p "$out"
log="$out/build.log"
"$nts" build "$source/tsconfig.json" --out "$out" --rc >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
if grep -q -E "refused and are absent|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "chromium-surface: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for product in app appLlvm; do
  dir="$out/$product/linux-gnu-x86_64"
  members=$(llvm-ar t "$dir/lib$product.a")
  case $members in
    *abi_check.c.o*) ;;
    *) echo "chromium-surface: $dir/lib$product.a has no abi_check.c.o; the target's native directory was not linked: $members" >&2; exit 1 ;;
  esac
  echo "chromium-surface ($product): built against the DOM surface, with its native half"
done
grep -q 'nts_dom_Document_createElement' "$out/app/linux-gnu-x86_64/program.c" ||
  { echo "chromium-surface: program.c calls no nts:dom function" >&2; exit 1; }
