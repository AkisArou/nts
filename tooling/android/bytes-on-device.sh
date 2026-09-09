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
work=${TMPDIR:-/tmp}/nts-artbytes.$$
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

printf "%-24s %12s %12s\n" "case" "HotSpot" "ART"
for case in $cases; do
  entry=$(grep -oE "^export function [A-Za-z0-9_]+" "$root/benches/cases/$case/case.ts" 2>/dev/null \
    | head -1 | awk '{print $3}')
  [ -n "$entry" ] || continue
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
        for (int i = 0; i < 20000; i++) { sink += nts.gen.Program.$entry(seed); }
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
    static double sink;
    public static void main(String[] a) throws Exception {
        Class<?> dbg = Class.forName("android.os.Debug");
        Method start = dbg.getMethod("startAllocCounting");
        Method stop = dbg.getMethod("stopAllocCounting");
        Method size = dbg.getMethod("getGlobalAllocSize");
        double seed = nts.gen.Program.seed;
        // ART has a JIT above its AOT image; a cold run would report the
        // interpreter's boxing rather than the program's.
        for (int i = 0; i < 20000; i++) { sink += nts.gen.Program.$entry(seed); }
        int n = Integer.parseInt(a[0]);
        start.invoke(null);
        long before = ((Number) size.invoke(null)).longValue();
        for (int i = 0; i < n; i++) { sink += nts.gen.Program.$entry(seed); }
        long after = ((Number) size.invoke(null)).longValue();
        stop.invoke(null);
        System.out.println((after - before) / n);
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
  art=$(adb shell "cd /data/local/tmp && dalvikvm -cp ab-$case.dex Main $device_runs" 2>&1 \
    | tr -d '\r' | tail -1)
  # A negative answer is the counter having wrapped, not a program that freed
  # memory. Say so rather than print it.
  case "$art" in
    -*) art="overflow" ;;
  esac
  adb shell "rm -f /data/local/tmp/ab-$case.dex" > /dev/null 2>&1 || true
  printf "%-24s %12s %12s\n" "$case" "$hotspot" "$art"
done
