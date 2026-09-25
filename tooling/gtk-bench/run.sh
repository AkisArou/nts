#!/bin/sh
# nts against GJS on GTK 4: the same program on both sides (nts/src/main.ts,
# gjs/bench.js), and C (c/bench.c) as the floor -- how much of a row is GTK's
# own work -- one process per case, under xvfb with cairo. Prints a table:
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
# The floor: the same cases in C against GTK, with -O2.
floor="$out/floor"
cc -O2 "$here/c/bench.c" $(pkg-config --cflags --libs gtk4) -o "$floor"
micro() {
  name=$1
  shift
  env BENCH_CASE="$name" GSK_RENDERER=cairo xvfb-run -a "$@" 2>/dev/null | awk -v n="$name" '$1 == n { print $2 }'
}
printf '| case | C | nts | gjs | gjs / nts |\n|---|---:|---:|---:|---:|\n'
for name in signal property construct method outs vfunc; do
  c=$(micro "$name" "$floor")
  a=$(micro "$name" "$bench")
  b=$(micro "$name" gjs "$here/gjs/bench.js")
  printf '| %s (ns/op) | %s | %s | %s | %s |\n' "$name" "$c" "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
done
# One X server for every startup run, so what is timed is the program.
startup=$(env BENCH_CASE=startup GSK_RENDERER=cairo xvfb-run -a sh -c "
  hyperfine -N --warmup 3 --runs 20 --export-json '$out/startup.json' '$bench' 'gjs $here/gjs/bench.js' '$floor' >/dev/null 2>&1
  /usr/bin/time -f %M '$bench' 2>&1 >/dev/null | tail -1
  /usr/bin/time -f %M gjs '$here/gjs/bench.js' 2>&1 >/dev/null | tail -1
")
a=$(awk -F'"mean": ' 'NF > 1 { split($2, v, ","); print v[1] * 1000; exit }' "$out/startup.json")
b=$(awk -F'"mean": ' 'NF > 1 { n++; if (n == 2) { split($2, v, ","); print v[1] * 1000; exit } }' "$out/startup.json")
c=$(awk -F'"mean": ' 'NF > 1 { n++; if (n == 3) { split($2, v, ","); print v[1] * 1000; exit } }' "$out/startup.json")
printf '| startup (ms) | %.1f | %.1f | %.1f | %s |\n' "$c" "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
set -- $startup
printf '| startup peak RSS (MB) | | %.1f | %.1f | %s |\n' "$(($1 / 1024))" "$(($2 / 1024))" "$(awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1fx", b / a }')"

# The notes application (examples/interop/gtk-notes, and gjs/notes.js line
# for line), whole: open, load 1000 notes into the list, add three through
# the button, save, quit. Each run starts from the same 1000-line file.
"$nts" build "$root/examples/interop/gtk-notes/tsconfig.json" --out "$out/notes" --rc >/dev/null
notes="$out/notes/notes/linux-gnu-x86_64/notes"
seed="$out/notes.seed"
awk 'BEGIN { for (i = 1; i <= 1000; i++) print "note " i }' > "$seed"
reset="cp $seed /tmp/nts-gtk-notes.txt"
app=$(env GSK_RENDERER=cairo xvfb-run -a sh -c "
  hyperfine -N --warmup 3 --runs 20 --prepare '$reset' --export-json '$out/notes.json' '$notes' 'gjs $here/gjs/notes.js' >/dev/null 2>&1
  $reset; /usr/bin/time -f %M '$notes' 2>&1 >/dev/null | tail -1
  $reset; /usr/bin/time -f %M gjs '$here/gjs/notes.js' 2>&1 >/dev/null | tail -1
")
rm -f /tmp/nts-gtk-notes.txt
a=$(awk -F'"mean": ' 'NF > 1 { split($2, v, ","); print v[1] * 1000; exit }' "$out/notes.json")
b=$(awk -F'"mean": ' 'NF > 1 { n++; if (n == 2) { split($2, v, ","); print v[1] * 1000; exit } }' "$out/notes.json")
printf '| notes app, 1000 notes (ms) | | %.1f | %.1f | %s |\n' "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
set -- $app
printf '| notes app peak RSS (MB) | | %.1f | %.1f | %s |\n' "$(($1 / 1024))" "$(($2 / 1024))" "$(awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1fx", b / a }')"

# The task list (tasks/src/main.ts, and gjs/tasks.js line for line): ten
# thousand tasks made and sorted in the program, and fifteen queries typed
# into a search whose filter is the program's own closure, run once per task
# per query. Its log is checked equal on both sides before anything is timed;
# the timing is the program's own (its `ms` line), best of five runs.
"$nts" build "$here/tasks/tsconfig.json" --out "$out/tasks" --rc >/dev/null
tasks="$out/tasks/tasks/linux-gnu-x86_64/tasks"
env GSK_RENDERER=cairo xvfb-run -a sh -c "
  '$tasks' > '$out/tasks.nts.log' 2>/dev/null
  gjs '$here/gjs/tasks.js' > '$out/tasks.gjs.log' 2>/dev/null
  for run in 1 2 3 4 5; do '$tasks' 2>/dev/null | grep '^ms ' >> '$out/tasks.nts.ms'; done
  for run in 1 2 3 4 5; do gjs '$here/gjs/tasks.js' 2>/dev/null | grep '^ms ' >> '$out/tasks.gjs.ms'; done
"
grep -v '^ms ' "$out/tasks.nts.log" > "$out/tasks.nts.checked"
grep -v '^ms ' "$out/tasks.gjs.log" > "$out/tasks.gjs.checked"
if [ ! -s "$out/tasks.nts.checked" ] || ! cmp -s "$out/tasks.nts.checked" "$out/tasks.gjs.checked"; then
  echo "FAILED gtk-bench: the task list's logs differ between nts and gjs" >&2
  exit 1
fi
best() { awk -v f="$1" 'NR == 1 || $f < m { m = $f } END { printf "%.1f", m }' "$2"; }
a=$(best 3 "$out/tasks.nts.ms"); b=$(best 3 "$out/tasks.gjs.ms")
printf '| task list: make and sort 10000 (ms) | | %s | %s | %s |\n' "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
a=$(best 5 "$out/tasks.nts.ms"); b=$(best 5 "$out/tasks.gjs.ms")
printf '| task list: 15 queries typed (ms) | | %s | %s | %s |\n' "$a" "$b" "$(awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1fx", b / a }')"
rm -f "$out/tasks.nts.ms" "$out/tasks.gjs.ms" "$out/tasks.nts.checked" "$out/tasks.gjs.checked"
