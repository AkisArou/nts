#!/bin/sh
# A program awaiting promises a foreign function answers -- made by the host,
# answered owned, settled later -- built through both backends and run.
#
# What each arm asserts:
#
# - **The build:** `nts build` exits 0 and refuses nothing: a `Promise<T>`
#   result crosses as the runtime's `NtsPromise *`.
# - **The run:** each build prints `expected.txt`: the awaits wait on the
#   host's promises and read what it settled them with.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-promise"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-promise"

mkdir -p "$out"
log="$out/build.log"
"$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
if grep -q -E "refused and are absent|NTS[0-9]{4}" "$log"; then
  cat "$log" >&2
  echo "native-promise: nts build refused part of the program and exited 0" >&2
  exit 1
fi
for product in promise promiseLlvm; do
  "$out/$product/linux-gnu-x86_64/$product" >"$out/$product.txt"
  diff -u "$source/expected.txt" "$out/$product.txt"
  echo "native-promise ($product): awaited the host's promises"
done
