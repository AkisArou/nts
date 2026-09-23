#!/bin/sh
# Build the library and the C program that links it, and check what C
# receives when TypeScript passes a `string`.
#
# Three checks, and each has an arm that must come out differently:
#
# - bytes: "α😀" arrives as CE B1 F0 9F 98 80, and "β😀" through the same
#   check does not (in caller.c);
# - U+0000: a string holding one ends the process with the boundary named,
#   rather than reaching C truncated;
# - leaks: under valgrind, the loss at 20000 calls is the loss at 1000. A
#   missing release loses one block per call, which this was run against:
#   1,000 and 100,003 blocks lost, against 0 and 3 (the bump arena's chunks).
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-string"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-string"
mkdir -p "$out"

"$nts" build "$source/tsconfig.json" --out "$out"
built="$out/lib/linux-gnu-x86_64"

"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/native" \
  -c "$source/consumer/caller.c" -o "$out/caller.o"
"$cc" "$out/caller.o" "$built/liblib.a" -lm -o "$out/caller"
"$out/caller"

if "$out/caller" nul > "$out/nul.out" 2>&1; then
  echo "FAILED native-string: a string holding U+0000 did not stop at the boundary" >&2
  exit 1
fi
if ! grep -q "containing U+0000 at index 1" "$out/nul.out"; then
  echo "FAILED native-string: the U+0000 refusal did not name the index:" >&2
  cat "$out/nul.out" >&2
  exit 1
fi
echo "a string holding U+0000 stops at the boundary: OK"

if ! command -v valgrind > /dev/null 2>&1; then
  echo "no valgrind on PATH: the leak arm did not run"
  exit 0
fi
lost() {
  valgrind --leak-check=full "$out/caller" many "$1" 2>&1 |
    awk '/definitely lost:/ { gsub(",", "", $7); print $7 }'
}
few=$(lost 1000)
lots=$(lost 20000)
if [ -z "$few" ] || [ -z "$lots" ]; then
  echo "FAILED native-string: valgrind reported no leak summary" >&2
  exit 1
fi
if [ "$lots" -gt "$((few + 16))" ]; then
  echo "FAILED native-string: $few blocks lost at 1000 calls, $lots at 20000" >&2
  exit 1
fi
echo "strings lent to C are released: $few block(s) lost at 1000 calls, $lots at 20000"
