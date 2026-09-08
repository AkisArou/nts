#!/bin/sh
# Instructions and cycles per operation, from a fixed-count driver.
#
#   tooling/bench/counted.sh generic-classes
#
# The published table is best-of-five with calibration, because that is what
# `bench.mjs` does for node and it is what makes the columns comparable to each
# other. It cannot resolve a small row. `generic-classes` published 1.03x and
# then 1.16x of the same bytecode, and this said 0.91x -- record 0154.
#
# So: call the case's own entry point N times and again at 2N, subtract, and
# divide. Startup and warmup are a constant and cancel; what is left is the
# operation. Instructions per operation are load-independent, so this does not
# need the measurement lock -- cycles do, and are reported for the ratio.
#
# # What that claim does not cover, and it is the calibration
#
# Load-independent is true of *load* and says nothing about **how much work
# this decided to measure**. Across five runs of one program the calibration
# below estimated 35, 45, 48, 78 and 97 us an operation -- a 2.8x spread in the
# chosen N. The N-versus-2N subtraction cancels startup and warmup only while
# both runs sit in the same regime, and at that spread they do not. So the tool
# is exact about work and imprecise about how much of it it took.
#
# Three runs of one unchanged build on `node-utf8`:
#
#     ours   1,428,086   1,396,634   1,436,667     spread 2.9%
#     java     228,758     232,322     238,491     spread 4.3%
#
# **The Java column is the tell.** It is an unchanged hand-written reference, so
# a 4.3% spread on it cannot be attributed to anything the compiler did; a
# spread on our side alone would always have had a second explanation. And the
# same row through `nts-bench` is 1% across five runs, so the program is steady
# and only this is not -- two harnesses over one program with one of them stable
# is what makes that a diagnosis rather than a suspicion.
#
# Right instrument for `generic-classes`, which published 1.03x and 1.16x of the
# same bytecode while this said 0.91x: that is a large difference in work and
# this resolves it. **Wrong instrument for four percent.** Pass `NTS_COUNTED_N`
# to take the calibration out of it when the question is small.
#
# Requires `nts-bench` to have generated the case at least once, since the
# drivers here are rewritten from the ones it wrote into `target/bench`.
set -eu
case=${1:?usage: counted.sh <case> [reps]}
reps=${2:-3}
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=${TMPDIR:-/tmp}/nts-counted.$$
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"

# The expression the harness times, lifted out of the generated driver. Ours is
# an anonymous `Bench.Work`; the reference is a class of its own, so its call is
# the one its `run` makes.
ours=$(sed -n 's/.*return \(nts\.gen\.Program\..*\);/\1/p' "$root/target/bench/$case.jvm/Case.java" | head -1)
seed=$(sed -n 's/.*private static volatile double in0 = \(.*\);/\1/p' "$root/target/bench/$case.jvm/Case.java" | head -1)
[ -n "$ours" ] || { echo "counted: no call in $case.jvm/Case.java" >&2; exit 2; }

# `$2` is evaluated once per iteration; `$3` is a declaration hoisted out of the
# loop, and it exists because the first version of this did not have it.
#
# The reference is a `Bench.Work` and the harness holds *one* of them, so a
# driver writing `new Ref().run()` in the loop allocates an object the published
# measurement does not -- and it charges that allocation to the reference alone,
# because our side calls a static method. A bias in the reference's disfavour is
# a bias in our favour, which is the direction that does not get noticed.
emit() { # dir, expression, hoisted declaration
  mkdir -p "$1"
  cat > "$1/Count.java" <<JAVA
public final class Count {
    private static volatile double in0 = ${seed:-1};
    public static void main(String[] argv) {
        int n = Integer.parseInt(argv[0]);
        double sink = 0;
        ${3:-}
        for (int i = 0; i < n; i++) { sink += $2; }
        System.out.println(sink);
    }
}
JAVA
}

jar=$root/target/bench/$case.jvm/nts-runtime.jar
mkdir -p "$work/ours"
cp -r "$root/target/bench/$case.jvm/nts" "$work/ours/"
emit "$work/ours" "$ours"
javac -cp "$work/ours:$jar" -d "$work/ours" "$work/ours/Count.java"

# The reference's entry is its own `run`, which takes no argument -- `Ref`
# extends `Bench.Work` and holds its input in a `volatile` of its own.
have_ref=no
if [ -f "$root/benches/cases/$case/ref.java" ]; then
  mkdir -p "$work/ref"
  cp "$root/benches/cases/$case/ref.java" "$work/ref/Ref.java"
  cp "$root/benches/common/Bench.java" "$work/ref/"
  # AWFY references reach for classes on the vendored classpath.
  awfy=$root/target/bench/awfy-java
  emit "$work/ref" "ref.run()" "final Ref ref = new Ref();"
  if javac -cp "$work/ref:$awfy" -d "$work/ref" "$work/ref"/*.java >/dev/null 2>&1; then
    have_ref=yes
    refpath="$work/ref:$awfy"
  fi
fi

count() { # classpath, event, n
  taskset -c "${NTS_CORES:-8-15}" perf stat -x, -e "$2" java -cp "$1" Count "$3" 2>&1 >/dev/null |
    awk -F, -v e="$2" '$0 ~ ("cpu_core/" e) {print $1}'
}

median() { tr ' ' '\n' | grep -v '^$' | sort -n | awk '{v[NR]=$1} END {print v[int((NR+1)/2)]}'; }

# `NTS_COUNTED_EVENTS` asks for more than the two. The two are the default
# because they answer *how much work* and *how long*, and everything else is
# for when those two disagree -- which is the case this tool exists to find.
# `branch-misses` and `stalled-cycles-backend` separate a prediction story from
# a memory one without a profiler.
report() { # label, classpath, n
  for event in ${NTS_COUNTED_EVENTS:-instructions cycles}; do
    low=""; high=""
    i=0
    while [ $i -lt "$reps" ]; do
      low="$low $(count "$2" "$event" "$3")"
      high="$high $(count "$2" "$event" $(($3 * 2)))"
      i=$((i + 1))
    done
    a=$(printf '%s' "$low" | median)
    b=$(printf '%s' "$high" | median)
    printf "%-10s %-12s %s\n" "$1" "$event" "$(( (b - a) / $3 ))"
  done
}

# How many operations to measure. A fixed count cannot serve both `symbol-keys`
# at 334 ns and `elementwise` at 61 us -- twenty thousand of the second is
# twenty minutes -- so it is calibrated the same way it is measured: wall time
# at a small count and at twice it, subtracted, which cancels startup and gives
# the marginal cost of one operation.
elapsed() { # classpath, n
  start=$(date +%s%N)
  java -cp "$1" Count "$2" >/dev/null 2>&1
  echo $(( ($(date +%s%N) - start) / 1000 ))
}
if [ -n "${NTS_COUNTED_N:-}" ]; then
  n=$NTS_COUNTED_N
else
  probe=200
  one=$(( ($(elapsed "$work/ours:$jar" $((probe * 2))) - $(elapsed "$work/ours:$jar" $probe)) / probe ))
  [ "$one" -lt 1 ] && one=1
  n=$(( 500000 / one ))
  [ "$n" -lt 500 ] && n=500
  [ "$n" -gt 2000000 ] && n=2000000
  echo "note: $one us an operation, measuring $n of them" >&2
fi
# Instructions are a count of work and do not care who else is on the machine.
# Cycles are a duration and do, so they are worth reading only under the
# measurement lock -- and the two disagreeing is the signal that something else
# is running, not that the row moved.
# Which of the two numbers to believe. The directory says somebody holds the
# measurement lock; it does not say whether that somebody is you, and the
# script cannot tell. Instructions are a count of work and do not care either
# way -- that is why they are here.
if [ -d /tmp/nts-gate/gate.lock.d ]; then
  echo "note: something holds the measurement lock. If it is not this run, the" >&2
  echo "      cycle counts are of a busy machine; the instruction counts are not." >&2
fi
report ours "$work/ours:$jar" "$n"
[ "$have_ref" = yes ] && report java "$refpath" "$n" || echo "java       -- (no reference)"
