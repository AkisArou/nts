#!/bin/sh
# Does what this backend emits run on ART, and answer what the JVM answers?
#
#     sh tooling/android/agrees-on-device.sh                 # a default set
#     sh tooling/android/agrees-on-device.sh fib checksum    # named cases
#
# # Why this is the first thing on the Android axis
#
# Two ratchets exist to hold this path open and neither of them opens it:
# `runtime_jar.rs` asserts the jar names no `invokedynamic` and targets class
# file version 52, which are the *preconditions* for `d8`, and until this script
# nothing had ever run `d8` or ART. A precondition that has never been tested
# against the thing it is a precondition for is a claim, not a check.
#
# It passes: nine cases, bit-identical between `java` and `dalvikvm`, including
# `symbol-keyed-map` and both `erasure-*` probes -- so `NtsMap`, `NtsValue`,
# symbols and the erased representation all survive the trip.
#
# # Bit patterns, not decimals
#
# `Double.doubleToRawLongBits`, for the reason the differential compares that
# way: `-0` and `0` print the same and are not the same, and a one-ulp
# difference in a Grisu port would read as agreement at any sane precision.
#
# # What it is not
#
# **Not a benchmark.** The device here is an x86_64 emulator, so timings from
# it are not a phone's. What survives emulation is *allocation*, which is
# deterministic, and *whether the program is correct*, which is what this asks.
# See `benches/jvm-rows.md` for what ART's missing C2 does to the numbers.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=${TMPDIR:-/tmp}/nts-art.$$
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}

command -v adb > /dev/null 2>&1 || { echo "SKIP: no adb" >&2; exit 0; }
adb get-state > /dev/null 2>&1 || { echo "SKIP: no device" >&2; exit 0; }
[ -n "$sdk" ] || { echo "SKIP: no ANDROID_HOME" >&2; exit 0; }
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$tools" ] || { echo "SKIP: no build-tools" >&2; exit 0; }

nts=${NTS_BIN:-$root/target-jvm/release/nts}
[ -x "$nts" ] || { echo "no nts at $nts -- set NTS_BIN" >&2; exit 1; }

mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

cases=${*:-"fib checksum accumulate loop array-methods symbol-keyed-map objects erasure-typed erasure-unknown"}
bad=0
skipped=0
for case in $cases; do
  entry=$(grep -oE "^export function [A-Za-z0-9_]+" "$root/benches/cases/$case/case.ts" 2>/dev/null \
    | head -1 | awk '{print $3}')
  # Two cases this driver cannot spell, and neither is the backend's fault --
  # which is what "javac failed" and "no exported entry" implied for two days.
  #
  # `elementwise` exports `scale(xs: number[], seed: number)`. This driver
  # passes one `double`; the array is why the case ships its own `driver.java`
  # for `tooling/bench` to use. `json-serialize` exports nothing from `case.ts`
  # at all -- its workload comes from `provider`.
  #
  # Counted apart from `bad`. A skip and a disagreement are different results
  # and the summary line said one of them for both.
  # A case whose workload the generated driver cannot synthesise ships its own
  # `driver.java`, and `elementwise` is the one that does: it hands the *same*
  # `double[]` to every call and refills it in place, so there is no argument
  # expression to write and no way to reset the state between runs.
  #
  # Driven here rather than skipped, because it is the only case with an array
  # crossing the boundary -- which is exactly the shape ART is most likely to
  # differ on, and so the worst one to leave uncovered. The case's own driver
  # runs against a one-shot `Bench` below.
  own=""
  [ -f "$root/benches/cases/$case/driver.java" ] && own=$root/benches/cases/$case/driver.java
  # `json-serialize` exports nothing from `case.ts` at all; its workload comes
  # from `provider`. Counted apart from `bad`: a skip and a disagreement are
  # different results and the summary line said one of them for both.
  [ -n "$entry" ] || { printf "%-22s case.ts exports no function\n" "$case"; skipped=$((skipped + 1)); continue; }

  out=$work/$case
  mkdir -p "$out/classes" "$out/dex"
  cat > "$out/tsconfig.json" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$root/benches/cases/$case"] }
JSON
  if ! NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} "$nts" emit-jvm "$out/tsconfig.json" \
    --out "$out/classes" --entry "$entry" --entry "module#init" > /dev/null 2>&1; then
    printf "%-22s the backend declined it\n" "$case"
    bad=$((bad + 1))
    continue
  fi
  # Module evaluation is a root in the same sense the entry point is: nothing
  # calls it, and the program is wrong without it. `--entry work` alone prunes
  # it -- `named_entry()` does not add it the way `tooling/bench` does -- and it
  # goes missing as a wrong *answer* rather than a link error, which is how this
  # stood: `symbol-keyed-map` answered 32768 where node answers 10240, because
  # five `const` symbols stayed null and five map keys collapsed into one.
  #
  # The flag is repeated rather than comma-joined: `named_entry()` collects
  # every `--entry` occurrence and does not split on commas, unlike
  # `requested_entry()` twenty lines above it, which does.
  if javap -p -cp "$out/classes" nts.gen.Program 2>/dev/null | grep -q 'module\$init'; then
    init='static { nts.gen.Program.module$init(); }'
  else
    init=''
  fi
  if [ -n "$own" ]; then
    # A one-shot `Bench`: `run()` once, print the bit pattern. Deliberately not
    # the timing harness -- this asks what the program answers, and warmup would
    # only make it answer it more times.
    main=Case
    cp "$own" "$out/Case.java"
    cat > "$out/Bench.java" <<'JAVA'
public final class Bench {
    private Bench() {}
    public abstract static class Work {
        public abstract double run();
    }
    public static void measure(Work work) {
        System.out.println(Long.toHexString(Double.doubleToRawLongBits(work.run())));
    }
}
JAVA
    sources="$out/Bench.java $out/Case.java"
  else
    main=Main
    cat > "$out/Main.java" <<JAVA
public final class Main {
    $init
    public static void main(String[] a) {
        double got = nts.gen.Program.$entry(nts.gen.Program.seed);
        System.out.println(Long.toHexString(Double.doubleToRawLongBits(got)));
    }
}
JAVA
    sources=$out/Main.java
  fi
  # shellcheck disable=SC2086
  javac -nowarn -cp "$out/classes:$out/classes/nts-runtime.jar" -d "$out/classes" \
    $sources 2> /dev/null || { printf "%-22s javac failed\n" "$case"; bad=$((bad + 1)); continue; }

  jvm=$(java -cp "$out/classes:$out/classes/nts-runtime.jar" "$main" 2>&1 | tail -1)
  # The runtime jar goes to `d8` whole: it is the artefact the ratchets are
  # about, and dexing the classes without it would test the wrong thing.
  if ! "$tools/d8" --min-api 29 --output "$out/dex" \
    $(find "$out/classes" -name '*.class') "$out/classes/nts-runtime.jar" > /dev/null 2>&1; then
    printf "%-22s d8 refused it\n" "$case"
    bad=$((bad + 1))
    continue
  fi
  adb push "$out/dex/classes.dex" "/data/local/tmp/nts-$case.dex" > /dev/null 2>&1
  art=$(adb shell "cd /data/local/tmp && dalvikvm -cp nts-$case.dex $main" 2>&1 | tr -d '\r' | tail -1)
  adb shell "rm -f /data/local/tmp/nts-$case.dex" > /dev/null 2>&1 || true

  if [ "$jvm" = "$art" ]; then
    printf "%-22s agree  %s\n" "$case" "$jvm"
  else
    printf "%-22s DIFFER jvm=%s art=%s\n" "$case" "$jvm" "$art"
    bad=$((bad + 1))
  fi
done

echo
[ "$skipped" = 0 ] && echo "every case was driven" \
  || echo "$skipped case(s) this driver cannot spell -- see the comment above"
[ "$bad" = 0 ] || { echo "$bad case(s) did not agree"; exit 1; }
echo "every case agrees between java and dalvikvm"
