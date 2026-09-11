#!/bin/sh
# What the hand-written reference allocates on ART.
#
#     sh tooling/android/ref-bytes-on-device.sh case-convert generator
#
# # Why this is the verdict and `bytes-on-device.sh` is only the screen
#
# That script compares one program across two runtimes, which finds every case
# where ART lacks an optimisation C2 has. Most of those are not this backend's
# fault: ART does no escape analysis on ordinary objects, so a program that
# allocates a shape per iteration pays for it here whoever wrote the program.
#
# Measured: `in-narrowing` allocates 81,920 bytes an operation on ART and
# **`ref.java` allocates 81,920** -- to the byte, because both create the same
# objects for the same reason. `generator` likewise, at 80,000 each. Reading
# the HotSpot-to-ART jump as a defect would have called both of those ours.
#
# `array-methods` is the one that was: 6288 against a reference that allocates
# nothing of the kind, from an `NtsValue` per round at a call boundary. `fuse`
# closed it. One in four.
#
# # The stub `Bench`
#
# `ref.java` is `final class Ref extends Bench.Work`, and the real `Bench` uses
# `com.sun.management.ThreadMXBean`, which Android has not got. So a stub
# carrying only the abstract `Work` is compiled beside it: the reference's own
# source is measured, unmodified, rather than a transcription of it -- which is
# the rule this repository keeps for `ref.cpp` and has cost this lane twice
# when it was broken.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# On disk and deliberately not through `TMPDIR`, which is `/tmp` here and `/tmp`
# is a 16G tmpfs. The trap below is `EXIT INT TERM`, which SIGKILL does not
# fire, so a killed run leaves classes and a copy of the runtime jar per case.
# Three of those filled the tmpfs until the shell could not start. This was the
# last sibling still pointing at it.
work=${NTS_ART_WORK:-$HOME/.cache/nts-android}/nts-refbytes.$$
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
runs=${NTS_ART_ITERATIONS:-2000}

command -v adb > /dev/null 2>&1 || { echo "SKIP: no adb" >&2; exit 0; }
adb get-state > /dev/null 2>&1 || { echo "SKIP: no device" >&2; exit 0; }
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$tools" ] || { echo "SKIP: no build-tools" >&2; exit 0; }

mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

# Only the abstract class the references extend. Deliberately not the timing
# harness: this measures allocation, and the harness's own would be counted.
mkdir -p "$work/stub"
cat > "$work/stub/Bench.java" <<'JAVA'
public final class Bench {
    private Bench() {}
    public abstract static class Work {
        public abstract double run();
    }
}
JAVA

cat > "$work/stub/RefBytes.java" <<'JAVA'
import java.lang.reflect.Method;
public final class RefBytes {
    static double sink;
    public static void main(String[] a) throws Exception {
        Bench.Work work = (Bench.Work) Class.forName("Ref")
            .getDeclaredConstructor().newInstance();
        Class<?> dbg = Class.forName("android.os.Debug");
        Method start = dbg.getMethod("startAllocCounting");
        Method stop = dbg.getMethod("stopAllocCounting");
        Method size = dbg.getMethod("getGlobalAllocSize");
        for (int i = 0; i < 20000; i++) { sink += work.run(); }
        int n = Integer.parseInt(a[0]);
        start.invoke(null);
        long before = ((Number) size.invoke(null)).longValue();
        for (int i = 0; i < n; i++) { sink += work.run(); }
        long after = ((Number) size.invoke(null)).longValue();
        stop.invoke(null);
        long each = (after - before) / n;
        System.out.println(each < 0 ? "overflow" : Long.toString(each));
    }
}
JAVA

awfy=$root/third_party/are-we-fast-yet/benchmarks/Java
printf "%-24s %14s\n" "case" "ref on ART"
for case in "$@"; do
  ref=$root/benches/cases/$case/ref.java
  [ -f "$ref" ] || { printf "%-24s %14s\n" "$case" "no ref.java"; continue; }
  out=$work/$case
  mkdir -p "$out/classes" "$out/dex"
  cp "$ref" "$out/Ref.java"
  cp "$work/stub/Bench.java" "$work/stub/RefBytes.java" "$out/"
  # The AWFY sources when they are there, for the eight `awfy-*` references
  # that construct one of their classes. Absent is fine and only those need it.
  sources=$(find "$out" -name '*.java')
  [ -d "$awfy" ] && sources="$sources $(find "$awfy" -name '*.java' 2>/dev/null)"
  # shellcheck disable=SC2086
  javac -nowarn -d "$out/classes" $sources 2> "$out/javac.log" \
    || { printf "%-24s %14s\n" "$case" "javac"; continue; }
  "$tools/d8" --min-api 29 --output "$out/dex" $(find "$out/classes" -name '*.class') \
    > /dev/null 2>&1 || { printf "%-24s %14s\n" "$case" "d8"; continue; }
  adb push "$out/dex/classes.dex" "/data/local/tmp/rb-$case.dex" > /dev/null 2>&1
  # `getGlobalAllocSize` is 32-bit and wraps, and there is no HotSpot figure to
  # size this run from the way `bytes-on-device.sh` does -- a reference has no
  # second runtime here. So: halve and retry.
  #
  # Without it `instanceof` and `optional-chain` both printed `overflow`, which
  # reads as "no answer" and is in fact the strongest possible one: the
  # reference allocates so much that 2,000 rounds overflow a 32-bit counter.
  attempt=$runs
  got=""
  while [ "$attempt" -ge 16 ]; do
    got=$(adb shell "cd /data/local/tmp && dalvikvm -cp rb-$case.dex RefBytes $attempt" 2>&1 \
      | tr -d '\r' | tail -1)
    case "$got" in
      overflow|-*) attempt=$((attempt / 8)) ;;
      *) break ;;
    esac
  done
  adb shell "rm -f /data/local/tmp/rb-$case.dex" > /dev/null 2>&1 || true
  printf "%-24s %14s\n" "$case" "$got"
done
