#!/bin/sh
# Swift's surface timed against Swift itself: src/main.ts and
# reference/bench.swift, the same loops, each run `runs` times on the lane's
# Mac, interleaved, and the median of each row printed beside Swift's.
#
#   sh examples/interop/macos-bench/bench.sh [runs]
#
# Not a gate step, and not named build.sh so the gate never runs it: the Mac is
# a VM whose timings move by 2x between runs, which is why this prints
# medians and why a row is only read as a ratio.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
runs=${1:-7}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/macos-bench"
apple=${NTS_APPLE_ROOT:-"$HOME/.cache/nts/apple"}
sdk=${NTS_APPLE_SDK:-"$apple/MacOSX.sdk"}
out=${NTS_BENCH_OUT:-"$root/target/interop-macos-bench"}
mkdir -p "$out"
NTS_APPLE_ROOT="$apple" NTS_APPLE_SDK="$sdk" "$nts" build "$source/tsconfig.json" --out "$out" >"$out/build.log" 2>&1 ||
  { cat "$out/build.log" >&2; exit 1; }
if grep -qE "refused|NTS[0-9]{4}" "$out/build.log"; then cat "$out/build.log" >&2; exit 1; fi
dest="${NTS_APPLE_SSH:-nts-mac}"
scp -q -o BatchMode=yes "$source/reference/bench.swift" "$dest:/tmp/nts-bench.swift"
ssh -o BatchMode=yes "$dest" 'cd /tmp && swiftc -O -target x86_64-apple-macos13 nts-bench.swift -o nts-bench-swift' >&2
: >"$out/ts.txt"
: >"$out/swift.txt"
i=0
while [ "$i" -lt "$runs" ]; do
  "$root/tooling/apple/run.sh" "$out/bench/macos-13-x86_64/bench" >>"$out/ts.txt"
  ssh -o BatchMode=yes "$dest" /tmp/nts-bench-swift >>"$out/swift.txt"
  i=$((i + 1))
done
median() {
  grep "^$1 " "$2" | awk '{ print $2 }' | sort -n | awk '{ v[NR] = $1 } END { print v[int((NR + 1) / 2)] }'
}
printf '%-12s %12s %12s %8s\n' row nts swift ratio
for row in $(awk '{ print $1 }' "$out/swift.txt" | awk '!seen[$0]++'); do
  a=$(median "$row" "$out/ts.txt")
  b=$(median "$row" "$out/swift.txt")
  printf '%-12s %12s %12s %8s\n' "$row" "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.2f", a / b }')"
done
