#!/bin/sh
# `bytes/op` on ART beside `bytes/op` on HotSpot, for the same program.
#
#     sh tooling/android/bytes-on-device.sh                # a default set
#     sh tooling/android/bytes-on-device.sh array-methods  # named cases
#
# # The third number in the bar, and why it is allocation and not time
#
# The device here is an emulator, so timings from it are not a phone's. What
# survives emulation is **allocation**: it is deterministic, and the counter
# below reads exactly 2064 bytes for a `double[256]` at 1, 100 and 1000
# iterations. So this axis can be trusted from an emulator and the timing axis
# cannot.
#
# It matters because a dozen optimisations were priced at zero on this lane and
# **every one was refuted by C2**. ART has no C2. `array-methods` was 144 B/op
# on HotSpot and 6288 on ART -- 256 `NtsValue`s a round that C2 scalar-replaced
# and ART could not, because they cross a call boundary that C2's inlining
# removes. `fuse` closed it; this script is how the next one is found.
#
# # The instrument
#
# `com.sun.management.ThreadMXBean` does not exist on Android, so the HotSpot
# counter cannot come along and the two columns use different instruments by
# necessity. Both are exact and both were checked against known allocations
# before anything was read from them.
#
# `android.os.Debug.startAllocCounting` is reached by reflection so the driver
# compiles against a plain JDK.
#
# # What a difference means
#
# ART worse than HotSpot is a real finding: something this backend emits needs
# an optimiser ART does not have. **ART better is not** -- the two counters
# measure slightly different things and a difference under a hundred bytes an
# operation is not worth reading either way.
#
# # The counter is 32 bits, and it said -247102
#
# `getGlobalAllocSize` answers an `int`. `array-from` allocates 8.28MB an
# operation, so two thousand of them is 16.5GB and the counter wraps -- and it
# wraps to a *plausible-looking negative number* rather than to anything that
# announces itself. It read **-247102 bytes/op**, which is arithmetic rather
# than measurement: 16.56e9 modulo 4.29e9 is about 3.7e9, which as a signed int
# is about -0.6e9, over two thousand iterations.
#
# So the iteration count is chosen from the HotSpot figure, which is measured
# first and is a 64-bit counter, to keep the ART total under 1.5e9. A run that
# still comes back negative prints `overflow` and not a number.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# Work on disk rather than in the tmpfs.
#
# `/tmp` here is a 16G tmpfs, and this script's cleanup is an `EXIT INT TERM`
# trap -- which SIGKILL does not fire. Three killed sweeps left three orphaned
# work directories, each holding classes and a copy of the runtime jar for up to
# sixty cases, and the tmpfs filled until the *shell* could not start: every
# command, `echo` included, failing because there was no room for its own
# snapshot. Nothing in the repository caused it and nothing in the repository
# would have found it.
#
# `TMPDIR` still wins if it is set, so a caller can put this anywhere. The
# default is a directory that survives being filled.
# Work on disk, and deliberately NOT through `TMPDIR`.
#
# `TMPDIR` is `/tmp` here and `/tmp` is a 16G tmpfs. This script's cleanup is an
# `EXIT INT TERM` trap, which SIGKILL does not fire, so three killed sweeps left
# three orphaned work directories -- each holding classes and a copy of the
# runtime jar for up to sixty cases. The tmpfs filled until the *shell* could
# not start: every command, `echo` included, failing because there was no room
# for its own snapshot.
#
# Honouring `TMPDIR` would have read as the fix and changed nothing, which is
# the worse outcome. `NTS_ART_WORK` overrides for a caller who wants it
# elsewhere; the default is a filesystem that does not take the machine with it.
work=${NTS_ART_WORK:-$HOME/.cache/nts-android}/nts-artbytes.$$
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
runs=${NTS_ART_ITERATIONS:-2000}

command -v adb > /dev/null 2>&1 || { echo "SKIP: no adb" >&2; exit 0; }
adb get-state > /dev/null 2>&1 || { echo "SKIP: no device" >&2; exit 0; }
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$tools" ] || { echo "SKIP: no build-tools" >&2; exit 0; }
nts=${NTS_BIN:-$root/target-jvm/release/nts}
[ -x "$nts" ] || { echo "no nts at $nts -- set NTS_BIN" >&2; exit 1; }

mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

cases=${*:-"array-methods symbol-keyed-map array-from arrays growth-fixed growth-grown
  objects erasure-typed erasure-unknown erasure-stored-typed erasure-stored-unknown
  map-and-set array-predicates array-mutations pipeline substrings case-convert
  strings number-format in-narrowing closures closure-merge module-closures generator"}

printf "%-24s %12s %12s %10s %6s\n" "case" "HotSpot" "ART" "objects" "avg"
for case in $cases; do
  entry=$(grep -oE "^export function [A-Za-z0-9_]+" "$root/benches/cases/$case/case.ts" 2>/dev/null \
    | head -1 | awk '{print $3}')
  # `elementwise` hands the same `double[]` to every call; both drivers below
  # pass one `double`, so neither can call it. Reported rather than printed as
  # a `javac` failure, which said the compiler was wrong.
  if [ -f "$root/benches/cases/$case/driver.java" ]; then
    printf "%-24s %12s %12s\n" "$case" "own-driver" "own-driver"
    continue
  fi
  [ -n "$entry" ] || { printf "%-24s %12s %12s\n" "$case" "no-entry" "no-entry"; continue; }
  out=$work/$case
  mkdir -p "$out/classes" "$out/dex"
  cat > "$out/tsconfig.json" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$root/benches/cases/$case"] }
JSON
  NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} "$nts" emit-jvm "$out/tsconfig.json" \
    --out "$out/classes" --entry "$entry" --entry "module#init" > /dev/null 2>&1 \
    || { printf "%-24s %12s %12s\n" "$case" "declined" "declined"; continue; }

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
  cat > "$out/H.java" <<JAVA
import com.sun.management.ThreadMXBean;
import java.lang.management.ManagementFactory;
public final class H {
    $init
    static double sink;
    public static void main(String[] a) {
        ThreadMXBean mx = (ThreadMXBean) ManagementFactory.getThreadMXBean();
        long id = Thread.currentThread().getId();
        double seed = nts.gen.Program.seed;
        // Warm up by *time*, not by a fixed count. Twenty thousand iterations
        // of awfy-mandelbrot is twenty thousand times twenty-two milliseconds,
        // and on an emulator that is over an hour for one row -- for a
        // measurement that is deterministic and does not need it.
        //
        // The warmup exists so ART has compiled the hot path rather than
        // interpreted it, since an interpreted run boxes differently. Five
        // seconds reaches that on an expensive case and a cheap one still gets
        // its full count.
        long until = System.nanoTime() + 5000000000L;
        for (int i = 0; i < 20000 && System.nanoTime() < until; i++) {
            sink += nts.gen.Program.$entry(seed);
        }
        int n = Integer.parseInt(a[0]);
        long before = mx.getThreadAllocatedBytes(id);
        for (int i = 0; i < n; i++) { sink += nts.gen.Program.$entry(seed); }
        System.out.println((mx.getThreadAllocatedBytes(id) - before) / n);
    }
}
JAVA
  cat > "$out/Main.java" <<JAVA
import java.lang.reflect.Method;
public final class Main {
    $init
    static double sink;
    public static void main(String[] a) throws Exception {
        Class<?> dbg = Class.forName("android.os.Debug");
        Method start = dbg.getMethod("startAllocCounting");
        Method tally = dbg.getMethod("getGlobalAllocCount");
        Method stop = dbg.getMethod("stopAllocCounting");
        Method size = dbg.getMethod("getGlobalAllocSize");
        double seed = nts.gen.Program.seed;
        // ART has a JIT above its AOT image; a cold run would report the
        // interpreter's boxing rather than the program's.
        // Warm up by *time*, not by a fixed count. Twenty thousand iterations
        // of awfy-mandelbrot is twenty thousand times twenty-two milliseconds,
        // and on an emulator that is over an hour for one row -- for a
        // measurement that is deterministic and does not need it.
        //
        // The warmup exists so ART has compiled the hot path rather than
        // interpreted it, since an interpreted run boxes differently. Five
        // seconds reaches that on an expensive case and a cheap one still gets
        // its full count.
        long until = System.nanoTime() + 5000000000L;
        for (int i = 0; i < 20000 && System.nanoTime() < until; i++) {
            sink += nts.gen.Program.$entry(seed);
        }
        int n = Integer.parseInt(a[0]);
        start.invoke(null);
        long before = ((Number) size.invoke(null)).longValue();
        long counted = ((Number) tally.invoke(null)).longValue();
        for (int i = 0; i < n; i++) { sink += nts.gen.Program.$entry(seed); }
        long after = ((Number) size.invoke(null)).longValue();
        long objects = ((Number) tally.invoke(null)).longValue() - counted;
        stop.invoke(null);
        // The count beside the bytes, because their quotient names the type.
        // node-utf8 read 15,366 objects at 23 bytes -- a String and its
        // backing array per character -- and that was the whole diagnosis.
        // No backticks in here: the heredoc is unquoted so the driver can
        // interpolate \$entry and \$init, and a backtick is a command.
        System.out.println(((after - before) / n) + " " + (objects / n));
    }
}
JAVA
  cp="$out/classes:$out/classes/nts-runtime.jar"
  javac -nowarn -cp "$cp" -d "$out/classes" "$out/H.java" "$out/Main.java" 2> /dev/null \
    || { printf "%-24s %12s %12s\n" "$case" "javac" "javac"; continue; }
  hotspot=$(java -cp "$cp" H "$runs" 2>&1 | tail -1)
  # Scale the device run so the 32-bit counter cannot wrap. HotSpot's counter
  # is 64-bit and is measured first, so its answer sizes the other one.
  device_runs=$runs
  case "$hotspot" in
    ''|*[!0-9]*) : ;;
    *)
      if [ "$hotspot" -gt 0 ]; then
        fits=$((1500000000 / hotspot))
        [ "$fits" -lt 1 ] && fits=1
        [ "$fits" -lt "$runs" ] && device_runs=$fits
      fi
      ;;
  esac
  "$tools/d8" --min-api 29 --output "$out/dex" $(find "$out/classes" -name '*.class') \
    "$out/classes/nts-runtime.jar" > /dev/null 2>&1 \
    || { printf "%-24s %12s %12s\n" "$case" "$hotspot" "d8"; continue; }
  adb push "$out/dex/classes.dex" "/data/local/tmp/ab-$case.dex" > /dev/null 2>&1
  # A negative answer is the 32-bit counter having wrapped, not a program that
  # freed memory. Halve and retry rather than report `overflow` and stop.
  #
  # The pre-scaling above sizes the device run from HotSpot's 64-bit answer,
  # which is exactly wrong for the rows that matter most here: `instanceof` and
  # `optional-chain` allocate **zero** on HotSpot because C2 scalar-replaces,
  # and a great deal on ART because it does not. A bound taken from the number
  # that is zero is no bound at all, and those two were the only two that
  # printed `overflow`.
  attempt=$device_runs
  art=""
  while [ "$attempt" -ge 16 ]; do
    art=$(adb shell "cd /data/local/tmp && dalvikvm -cp ab-$case.dex Main $attempt" 2>&1 \
      | tr -d '\r' | tail -1)
    case "$art" in
      -*) attempt=$((attempt / 8)) ;;
      *) break ;;
    esac
  done
  case "$art" in
    -*) art="overflow" ;;
  esac
  adb shell "rm -f /data/local/tmp/ab-$case.dex" > /dev/null 2>&1 || true
  objects=$(printf "%s" "$art" | awk "{print \$2}")
  art=$(printf "%s" "$art" | awk "{print \$1}")
  avg=$(printf "%s %s" "$art" "$objects" | awk "{ if (\$2 > 0) print int(\$1 / \$2); else print \"--\" }")
  printf "%-24s %12s %12s %10s %6s\n" "$case" "$hotspot" "${art:---}" "${objects:---}" "${avg:---}"
done
