#!/bin/sh
# Instructions and cycles per operation, from a fixed-count driver.
#
#   tooling/bench/counted.sh generic-classes
#
# The published table is best-of-five with calibration, because that is what
# `bench.mjs` does for node and it is what makes the columns comparable to each
# other. It cannot resolve a small row. `generic-classes` published 1.03x and
# then 1.16x of the same bytecode, and this said 0.91x -- record 0152.
#
# So: call the case's own entry point N times and again at 2N, subtract, and
# divide. Startup and warmup are a constant and cancel; what is left is the
# operation. Instructions per operation are load-independent, so this does not
# need the measurement lock -- cycles do, and are reported for the ratio.
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

emit() { # dir, expression
  mkdir -p "$1"
  cat > "$1/Count.java" <<JAVA
public final class Count {
    private static volatile double in0 = ${seed:-1};
    public static void main(String[] argv) {
        int n = Integer.parseInt(argv[0]);
        double sink = 0;
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
  emit "$work/ref" "new Ref().run()"
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

report() { # label, classpath, n
  for event in instructions cycles; do
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

n=${NTS_COUNTED_N:-20000}
# Instructions are a count of work and do not care who else is on the machine.
# Cycles are a duration and do, so they are worth reading only under the
# measurement lock -- and the two disagreeing is the signal that something else
# is running, not that the row moved.
if [ ! -d /tmp/nts-gate/gate.lock.d ]; then
  echo "note: nobody holds the measurement lock; cycles are comparable, instructions are trustworthy" >&2
else
  echo "note: the measurement lock is held; read instructions and distrust cycles" >&2
fi
report ours "$work/ours:$jar" "$n"
[ "$have_ref" = yes ] && report java "$refpath" "$n" || echo "java       -- (no reference)"
