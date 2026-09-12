#!/bin/sh
# Bar 1 -- jvm/Java -- on ART as well as on HotSpot.
#
#     sh tooling/android/times-on-device.sh fib dispatch awfy-queens
#
# # Why a timing on an emulator is worth anything at all
#
# It is not, as a nanosecond. `benches/jvm-rows.md` measures absolute times on
# this machine's HotSpot and nothing here replaces one of them.
#
# But the bar is not a nanosecond. It is **jvm over Java**: two programs, one
# runtime, one harness, one process launch apart. Whatever the emulator adds --
# a slower interpreter, no KVM, a cold page cache -- it adds to both halves of
# the fraction, and the fraction is the claim. That is the same argument
# `bytes-on-device.sh` already makes for allocation and it is why that survey
# was worth running before a phone existed.
#
# # The instrument is its own control
#
# Four runs per case, not two: the same generated driver and the same harness
# on HotSpot **and** on ART, for both the compiled program and `ref.java`.
#
# The HotSpot pair is the control. Its ratio has an independent published value
# in `benches/jvm-rows.md`, measured by `tooling/bench` with a different driver
# path and a real `Bench`. If this script's HotSpot column reproduces it, the
# harness is not distorting the fraction and the ART column means what it says.
# If it does not, the ART column is worthless and the HotSpot column says so
# before anyone reads further. A survey with no way to be wrong is the failure
# mode this repository keeps rediscovering.
#
# # The harness is a transcription, and the three ways it could lie
#
# `benches/common/Bench.java` cannot be used as it stands: its allocation arm
# names `com.sun.management.ThreadMXBean`, which Android has not got. So the
# timing arm is transcribed below -- **same constants**, because three lanes
# measured three ways are three experiments.
#
#   - `Locale.ROOT` on the `printf`, which the original does not need and this
#     does: a device whose default locale spells a decimal comma would print a
#     number this script then parses as an integer. It changes the text and not
#     the measurement, and both sides get it.
#   - `Ref` **is** the `Bench.Work`, never something a `Work` calls. One extra
#     static call cost `awfy-sieve`'s reference 18%, which is a tax in the one
#     direction a harness must never be wrong in.
#   - The `volatile double` input, so a loop-invariant argument cannot let the
#     JIT hoist the call out of the timed loop. This is what the C shim spells
#     with the same keyword and what the node harness spells through `argv`.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# On disk and deliberately not through `TMPDIR`, which is `/tmp` here and `/tmp`
# is a 16G tmpfs. The trap below does not fire on SIGKILL, and three killed runs
# of a sibling script filled it until the shell could not start.
work=${NTS_ART_WORK:-$HOME/.cache/nts-android}/nts-times.$$
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
# Are We Fast Yet's own Java, which the eight `awfy-*` references construct.
#
# **`NTS_AWFY`, because `$root` is the wrong answer from a pinned worktree.**
# `git worktree add` populates the tree and not the submodules, so a run pinned
# to a hash finds `third_party/are-we-fast-yet` empty -- 79 source files in the
# checkout beside it and 0 in the tree being measured. All eight `awfy-*` rows
# came back `javac declined ref.java` with `symbol: class Queens`, which reads
# as a broken reference rather than an absent dependency.
#
# That is the same trap as `NTS_BIN` and `NTS_TSGO`, which this lane already
# passes as absolute paths into the checkout for exactly this reason, and it
# was missed because those two are named in the note and this one is not.
awfy=${NTS_AWFY:-$root/third_party/are-we-fast-yet/benchmarks/Java}

command -v adb > /dev/null 2>&1 || { echo "SKIP: no adb" >&2; exit 0; }
adb get-state > /dev/null 2>&1 || { echo "SKIP: no device" >&2; exit 0; }
[ -n "$sdk" ] || { echo "SKIP: no ANDROID_HOME" >&2; exit 0; }
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$tools" ] || { echo "SKIP: no build-tools" >&2; exit 0; }

nts=${NTS_BIN:-$root/target-jvm/release/nts}
[ -x "$nts" ] || { echo "no nts at $nts -- set NTS_BIN" >&2; exit 1; }

mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

# The same flags `tooling/bench` gives every JVM column: the default collector
# changes with the host, and a column that changes meaning with the machine is
# not an instrument. Equal bounds so no resizing happens mid-run.
hotspot="-XX:+UseG1GC -Xms512m -Xmx512m -XX:-UsePerfData"

mkdir -p "$work/common"
cat > "$work/common/Bench.java" <<'JAVA'
import java.util.Locale;

/** The timing arm of benches/common/Bench.java, transcribed with its constants. */
public final class Bench {
    private Bench() {}

    public abstract static class Work {
        public abstract double run();
    }

    public static void measure(Work work) {
        // One call before anything: it takes the checksum, loads the classes and
        // runs every <clinit>, so none of that lands inside a timed region.
        double checksum = work.run();

        // Bounded by time as well as by count, exactly as the other lanes are.
        // On ART the count is the binding one far more often than on HotSpot,
        // because every iteration is slower -- which is a reason to keep both
        // bounds identical rather than to tune one for this runtime.
        long until = System.nanoTime() + 300_000_000L;
        for (int i = 0; i < 20000 && System.nanoTime() < until; i++) {
            work.run();
        }

        long probe = System.nanoTime();
        work.run();
        double one = System.nanoTime() - probe;
        long reps = (long) Math.floor(1e8 / Math.max(one, 1));
        reps = Math.min(Math.max(reps, 1), 50_000_000L);

        double best = Double.POSITIVE_INFINITY;
        double sink = 0;
        for (int trial = 0; trial < 5; trial++) {
            long began = System.nanoTime();
            for (long i = 0; i < reps; i++) {
                sink += work.run();
            }
            double per = (double) (System.nanoTime() - began) / (double) reps;
            if (per < best) {
                best = per;
            }
        }
        if (Double.isNaN(sink)) {
            throw new AssertionError("unreachable");
        }
        System.out.printf(Locale.ROOT, "%.4f %016x%n", best,
            Double.doubleToRawLongBits(checksum));
    }
}
JAVA

# The reference driver, identical for every case: `Ref` is the `Work` itself.
cat > "$work/common/RefCase.java" <<'JAVA'
public final class Case {
    public static void main(String[] argv) {
        Bench.measure(new Ref());
    }
}
JAVA

# One number from a run, or the word that says why there is none.
timing() { printf '%s' "$1" | awk 'NF >= 2 && $1 ~ /^[0-9.]+$/ { print $1 }'; }
checksum() { printf '%s' "$1" | awk 'NF >= 2 && $1 ~ /^[0-9.]+$/ { print $2 }'; }

cases=${*:-"fib checksum dispatch awfy-queens awfy-sieve objects closures"}
printf "%-24s %10s %10s %7s   %10s %10s %7s\n" \
  case "nts HS" "ref HS" "HS" "nts ART" "ref ART" "ART"

for case in $cases; do
  dir=$root/benches/cases/$case
  [ -f "$dir/ref.java" ] || { printf "%-24s %s\n" "$case" "no ref.java"; continue; }
  out=$work/$case
  mkdir -p "$out/nts/dex" "$out/ref/dex"

  # ---- the compiled program -------------------------------------------------
  entry=$(grep -oE "^export function [A-Za-z0-9_]+" "$dir/case.ts" 2>/dev/null \
    | head -1 | awk '{print $3}')
  cat > "$out/tsconfig.json" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$dir"] }
JSON
  # `--entry` twice: `named_entry()` collects every occurrence and does not
  # split on commas, and `--entry work` alone prunes module evaluation -- which
  # goes missing as a wrong answer rather than a link error.
  if ! NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} "$nts" emit-jvm "$out/tsconfig.json" \
       --out "$out/nts/classes" --entry "${entry:-module#init}" --entry "module#init" \
       > "$out/emit.log" 2>&1; then
    printf "%-24s %s\n" "$case" "the backend declined it"
    continue
  fi
  if javap -p -cp "$out/nts/classes" nts.gen.Program 2>/dev/null | grep -q 'module\$init'; then
    init='static { nts.gen.Program.module$init(); }'
  else
    init=''
  fi
  if [ -f "$dir/driver.java" ]; then
    # A case whose workload is not one call with one scalar ships its own, and
    # it is taken verbatim -- the same file `tooling/bench` compiles.
    cp "$dir/driver.java" "$out/nts/Case.java"
  else
    seed=$(grep -oE "^export const seed = [^;]+" "$dir/case.ts" 2>/dev/null \
      | head -1 | sed 's/^export const seed = //')
    [ -n "$entry" ] && [ -n "$seed" ] || {
      printf "%-24s %s\n" "$case" "no workload and no driver.java"; continue; }
    cat > "$out/nts/Case.java" <<JAVA
public final class Case {
    $init
    private static volatile double in0 = $seed;
    public static void main(String[] argv) {
        Bench.measure(new Bench.Work() {
            @Override public double run() {
                return nts.gen.Program.$entry(in0);
            }
        });
    }
}
JAVA
  fi
  cp "$work/common/Bench.java" "$out/nts/"
  if ! javac -nowarn -cp "$out/nts/classes:$out/nts/classes/nts-runtime.jar" \
       -d "$out/nts/classes" "$out/nts/Bench.java" "$out/nts/Case.java" \
       > "$out/nts/javac.log" 2>&1; then
    printf "%-24s %s\n" "$case" "javac declined the generated driver"
    continue
  fi
  # **`--release` by default: a shipped application is dexed that way.** `d8`
  # defaults to *debug*, which keeps local-variable scopes alive and pads with
  # `nop // spacer` -- and it is not symmetric, because this backend emits
  # `LineNumberTable` and `LocalVariableTable` per instruction for the
  # provenance chain and `javac` output carries far less. Measured 2026-09-12:
  # debug inflates `nts/gen/*` by **27.5%** and the hand-written side by 2.8%.
  #
  # Worth 0.07 on `awfy-towers`'s ratio and no more, which is consistent rather
  # than disappointing: size pays only where it crosses ART's inliner budget.
  # `moveDisks` crosses (49 code units to 21, level with the reference) and
  # `popDiskFrom` does not (67 to 51, still over).
  #
  # `NTS_D8_DEBUG=1` goes back, for a run compared against a figure taken
  # before this changed. **Every ART number in `benches/jvm-rows.md` older than
  # 2026-09-12 is debug-dexed** and is pessimistic by about that much.
  # shellcheck disable=SC2046
  if ! "$tools/d8" ${NTS_D8_DEBUG:-"--release"} --min-api 29 --output "$out/nts/dex" \
       $(find "$out/nts/classes" -name '*.class') \
       "$out/nts/classes/nts-runtime.jar" > "$out/nts/d8.log" 2>&1; then
    printf "%-24s %s\n" "$case" "d8 refused it"
    continue
  fi

  # ---- the hand-written reference -------------------------------------------
  cp "$dir/ref.java" "$out/ref/Ref.java"
  cp "$work/common/Bench.java" "$out/ref/"
  cp "$work/common/RefCase.java" "$out/ref/Case.java"
  refcp=$out/ref/classes
  mkdir -p "$refcp"
  # Are We Fast Yet's own classes when the clone is there: the eight `awfy-*`
  # references construct one of theirs and the class stays theirs. Compiled from
  # source rather than listed per case, as `tooling/bench` does.
  sources="$out/ref/Ref.java $out/ref/Bench.java $out/ref/Case.java"
  theirs=$(find "$awfy" -name '*.java' 2>/dev/null)
  # An absent dependency is reported as one. Without this the eight rows that
  # need it fail inside `javac` with an unresolved symbol, which counts as the
  # reference being broken -- and a row that is missing for a reason the survey
  # can name is worth more than a row that is missing.
  case "$case" in
    awfy-*)
      [ -n "$theirs" ] || {
        printf "%-24s %s\n" "$case" "no are-we-fast-yet sources -- set NTS_AWFY"
        continue; } ;;
  esac
  [ -n "$theirs" ] && sources="$sources $theirs"
  # shellcheck disable=SC2086
  if ! javac -nowarn -d "$refcp" $sources > "$out/ref/javac.log" 2>&1; then
    printf "%-24s %s\n" "$case" "javac declined ref.java"
    continue
  fi
  # shellcheck disable=SC2046
  if ! "$tools/d8" ${NTS_D8_DEBUG:-"--release"} --min-api 29 --output "$out/ref/dex" \
       $(find "$refcp" -name '*.class') > "$out/ref/d8.log" 2>&1; then
    printf "%-24s %s\n" "$case" "d8 refused ref.java"
    continue
  fi

  # ---- four runs ------------------------------------------------------------
  # shellcheck disable=SC2086
  nts_hs=$(java $hotspot -cp "$out/nts/classes:$out/nts/classes/nts-runtime.jar" Case 2>&1 | tail -1)
  # shellcheck disable=SC2086
  ref_hs=$(java $hotspot -cp "$refcp" Case 2>&1 | tail -1)
  adb push "$out/nts/dex/classes.dex" "/data/local/tmp/t-$case-nts.dex" > /dev/null 2>&1
  adb push "$out/ref/dex/classes.dex" "/data/local/tmp/t-$case-ref.dex" > /dev/null 2>&1
  nts_art=$(adb shell "cd /data/local/tmp && dalvikvm -cp t-$case-nts.dex Case" 2>&1 \
    | tr -d '\r' | tail -1)
  ref_art=$(adb shell "cd /data/local/tmp && dalvikvm -cp t-$case-ref.dex Case" 2>&1 \
    | tr -d '\r' | tail -1)
  adb shell "rm -f /data/local/tmp/t-$case-nts.dex /data/local/tmp/t-$case-ref.dex" \
    > /dev/null 2>&1 || true

  a=$(timing "$nts_hs"); b=$(timing "$ref_hs")
  c=$(timing "$nts_art"); d=$(timing "$ref_art")
  hs=$(awk -v a="$a" -v b="$b" 'BEGIN { if (a != "" && b > 0) printf "%.2fx", a / b; else print "--" }')
  art=$(awk -v c="$c" -v d="$d" 'BEGIN { if (c != "" && d > 0) printf "%.2fx", c / d; else print "--" }')
  printf "%-24s %10s %10s %7s   %10s %10s %7s" \
    "$case" "${a:---}" "${b:---}" "$hs" "${c:---}" "${d:---}" "$art"
  # The same program on two runtimes must answer the same thing. A ratio over
  # two programs that disagree is a number about a bug, and it would read
  # exactly like a number about a runtime.
  [ "$(checksum "$nts_hs")" = "$(checksum "$nts_art")" ] || printf "  nts DISAGREES across runtimes"
  [ "$(checksum "$ref_hs")" = "$(checksum "$ref_art")" ] || printf "  ref DISAGREES across runtimes"
  [ "$(checksum "$nts_hs")" = "$(checksum "$ref_hs")" ] || printf "  nts and ref compute different things"
  printf "\n"
done
