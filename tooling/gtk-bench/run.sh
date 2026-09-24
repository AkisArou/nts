#!/bin/sh
# nts against GJS on GTK 4: the same program on both sides (nts/src/main.ts,
# gjs/bench.js), one process per case, under xvfb with cairo. Prints a table:
# nanoseconds per operation for the micro cases (best of three timed runs in
# the process, after one untimed), startup to a mapped window (hyperfine, mean
# of 20 after 3 warm-ups), and the peak resident set of that startup.
#
# nts is built under reference counting, the mode a real program runs in.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
nts=${NTS_BIN:-"$root/target/release/nts"}
out=${1:-"$root/target/gtk-bench"}
for tool in gjs xvfb-run hyperfine /usr/bin/time; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP gtk-bench: no $tool"; exit 0; }
done
# `nts.config.ts` imports `@nts/config`, which is this repository's own.
mkdir -p "$here/node_modules/@nts"
ln -sfn ../../../config "$here/node_modules/@nts/config"
"$nts" build "$here/nts/tsconfig.json" --out "$out" --rc >/dev/null
bench="$out/bench/linux-gnu-x86_64/bench"
[ -x "$bench" ] || { echo "FAILED gtk-bench: $bench was not built" >&2; exit 1; }
micro() {
  name=$1
  shift
  env BENCH_CASE="$name" GSK_RENDERER=cairo xvfb-run -a "$@" 2>/dev/null | awk -v n="$name" '$1 == n { print $2 }'
}
printf '| case | nts | gjs | gjs / nts |\n|---|---:|---:|---:|\n'
for name in signal property construct method; do
  a=$(micro "$name" "$bench")
  b=$(micro "$name" gjs "$here/gjs/bench.js")
  printf '| %s (ns/op) | %s | %s | %s |\n' "$name" "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
done
# One X server for every startup run, so what is timed is the program.
startup=$(env BENCH_CASE=startup GSK_RENDERER=cairo xvfb-run -a sh -c "
  hyperfine -N --warmup 3 --runs 20 --export-json '$out/startup.json' '$bench' 'gjs $here/gjs/bench.js' >/dev/null 2>&1
  /usr/bin/time -f %M '$bench' 2>&1 >/dev/null | tail -1
  /usr/bin/time -f %M gjs '$here/gjs/bench.js' 2>&1 >/dev/null | tail -1
")
a=$(awk -F'"mean": ' 'NF > 1 { split($2, v, ","); print v[1] * 1000; exit }' "$out/startup.json")
b=$(awk -F'"mean": ' 'NF > 1 { n++; if (n == 2) { split($2, v, ","); print v[1] * 1000; exit } }' "$out/startup.json")
printf '| startup (ms) | %.1f | %.1f | %s |\n' "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
set -- $startup
printf '| startup peak RSS (MB) | %.1f | %.1f | %s |\n' "$(($1 / 1024))" "$(($2 / 1024))" "$(awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1fx", b / a }')"
