#!/bin/sh
# Does ART's **AOT** code change the ratio ART's JIT reports?
#
#     sh tooling/android/aot-on-device.sh              # a default case
#     sh tooling/android/aot-on-device.sh awfy-queens  # named
#
# # Why this is a question about the whole ART column
#
# `times-on-device.sh` and `bytes-on-device.sh` both run `dalvikvm -cp x.dex`.
# A raw dex in `/data/local/tmp` has no `.odex`, so that is ART's **interpreter
# and JIT**. A shipped Android application does not run that way: the system
# runs `dex2oat` and the app executes AOT-compiled code. So every ART *timing*
# in `benches/jvm-rows.md` is about a mode no product ships, and the bar's
# second and third numbers are written about Android.
#
# A ratio is fairer than an absolute -- ours and the reference get the same
# treatment -- but "the same treatment" is the assumption being tested here, and
# it is exactly the kind this file has been wrong about. Our emitted programs
# have more methods and larger ones than a hand-written reference, and tier-up
# is per method.
#
# # Why an APK, when `dex2oat` is right there
#
# It is not: `dex2oat` is **inaccessible to the shell user** on this emulator,
# which `benches/jvm-rows.md` already records as what stopped the profile. What
# is *not* recorded, and is true, is that **`oatdump` runs fine from the shell**
# -- so the artefact can be read once something produces it.
#
# The system produces it for an installed package. `cmd package compile -m speed
# -f` is `dex2oat` run by the one user allowed to, and `proxy-app.sh` already
# established every step of getting an APK onto this device.
#
# # One measurement implementation, not two
#
# `benches/common/Bench.java` is compiled in verbatim and `Case.main` is called
# unchanged; the activity captures `System.out` rather than reimplementing the
# warmup and the best-of-five. `awfy-sieve` is why -- two harnesses that should
# agree differ by 40% on that row, reproducibly, and this file is not adding a
# third. What is measured here is the same loop in a different execution mode.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=${NTS_AOT_WORK:-$HOME/.cache/nts-android}/aot.$$
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
package=org.nts.benchprobe
awfy=${NTS_AWFY:-$root/third_party/are-we-fast-yet/benchmarks/Java}

[ -n "$sdk" ] || { echo "SKIP: no ANDROID_HOME" >&2; exit 0; }
plat=$sdk/platforms/android-29/android.jar
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$tools" ] || { echo "SKIP: no build-tools" >&2; exit 0; }
[ -f "$plat" ] || { echo "SKIP: no android-29 platform jar" >&2; exit 0; }
command -v adb > /dev/null 2>&1 || { echo "SKIP: no adb" >&2; exit 0; }
adb get-state > /dev/null 2>&1 || { echo "SKIP: no device" >&2; exit 0; }
command -v keytool > /dev/null 2>&1 || { echo "SKIP: no keytool" >&2; exit 0; }

nts=${NTS_BIN:-$root/target-jvm/release/nts}
[ -x "$nts" ] || { echo "no nts at $nts -- set NTS_BIN" >&2; exit 1; }

mkdir -p "$work"
[ "${NTS_AOT_KEEP:-0}" != 0 ] || trap 'rm -rf "$work"' EXIT INT TERM

cat > "$work/AndroidManifest.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="$package">
  <application android:label="nts bench probe">
    <activity android:name=".BenchActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
XML

mkdir -p "$work/probe/org/nts/benchprobe"
# `Case.main` unchanged, with `System.out` captured. On a thread, because
# `Bench.measure` warms for up to 300ms and then runs five trials, and doing
# that on the UI thread is an ANR rather than a measurement.
cat > "$work/probe/org/nts/benchprobe/BenchActivity.java" <<'JAVA'
package org.nts.benchprobe;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Method;

public final class BenchActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        // `Case` is in the unnamed package -- it is the same generated driver
        // `times-on-device.sh` compiles, and changing it here would make this a
        // different program from the one being compared. A named package cannot
        // import from the unnamed one, so it is reached reflectively, the way
        // `ref-bytes-on-device.sh` reaches `Ref`.
        new Thread(new Runnable() {
            @Override public void run() {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                PrintStream was = System.out;
                try {
                    Method main = Class.forName("Case").getMethod("main", String[].class);
                    System.setOut(new PrintStream(buffer, true, "UTF-8"));
                    main.invoke(null, (Object) new String[0]);
                    System.setOut(was);
                    Log.i("NTSAOT", "RESULT " + buffer.toString("UTF-8").trim());
                } catch (Throwable failed) {
                    System.setOut(was);
                    Log.i("NTSAOT", "FAILED " + failed);
                }
            }
        }).start();
    }
}
JAVA

case=${1:-awfy-queens}
dir=$root/benches/cases/$case
[ -f "$dir/ref.java" ] || { echo "no ref.java for $case" >&2; exit 1; }

entry=$(grep -oE "^export function [A-Za-z0-9_]+" "$dir/case.ts" 2>/dev/null \
  | head -1 | awk '{print $3}')
seed=$(grep -oE "^export const seed = [^;]+" "$dir/case.ts" 2>/dev/null \
  | head -1 | sed 's/^export const seed = //')

cat > "$work/tsconfig.json" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$dir"] }
JSON
NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} "$nts" emit-jvm "$work/tsconfig.json" \
  --out "$work/nts-classes" --entry "${entry:-module#init}" --entry "module#init" \
  > "$work/emit.log" 2>&1 || { echo "the backend declined $case" >&2; exit 1; }

if javap -p -cp "$work/nts-classes" nts.gen.Program 2>/dev/null | grep -q 'module\$init'; then
  init='static { nts.gen.Program.module$init(); }'
else
  init=''
fi

mkdir -p "$work/src-nts" "$work/src-ref"
if [ -f "$dir/driver.java" ]; then
  cp "$dir/driver.java" "$work/src-nts/Case.java"
else
  [ -n "$entry" ] && [ -n "$seed" ] || { echo "no workload and no driver.java" >&2; exit 1; }
  cat > "$work/src-nts/Case.java" <<JAVA
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
# `NTS_AOT_REF` substitutes a different reference, which is how a *shape* is
# priced without touching the backend: write the shape into the hand-written
# Java, check in `javap` that it produced the bytecode intended, and measure.
#
# The check matters. This file already records a transcription of one of our
# bytecode shapes into source costing 1.35x while fixing the emitter moved
# 0.16% -- a transcription is not the bytecode. What makes this usable is that
# the property under test here is **method size**, which `javap -c` reports
# directly, so the transcription can be verified rather than assumed.
cp "${NTS_AOT_REF:-$dir/ref.java}" "$work/src-ref/Ref.java"
cat > "$work/src-ref/Case.java" <<'JAVA'
public final class Case {
    public static void main(String[] argv) { Bench.measure(new Ref()); }
}
JAVA
cp "$root/benches/common/Bench.java" "$work/src-nts/"
cp "$root/benches/common/Bench.java" "$work/src-ref/"

# ---- one APK per side, same package, installed one at a time ---------------
build_and_run() {
  side=$1
  method=${2:-}
  rm -rf "$work/build"; mkdir -p "$work/build/classes" "$work/build/dex"
  extra=""
  if [ "$side" = ref ]; then
    case "$case" in
      awfy-*)
        extra=$(find "$awfy" -name '*.java' 2>/dev/null)
        [ -n "$extra" ] || { echo "$side: no awfy sources" >&2; return 1; } ;;
    esac
  fi
  # No `-bootclasspath` beside `--release 8`: javac refuses the pair. The
  # platform jar goes on the classpath, which is what `proxy-app.sh` does.
  # shellcheck disable=SC2086
  javac --release 8 -nowarn -Xlint:-options \
    -cp "$plat:$work/nts-classes:$work/nts-classes/nts-runtime.jar" \
    -d "$work/build/classes" \
    $(find "$work/src-$side" "$work/probe" -name '*.java') $extra \
    > "$work/javac-$side.log" 2>&1 || { echo "$side: javac"; sed -n 1,3p "$work/javac-$side.log"; return 1; }

  # The runtime jar is a d8 **input** and not a `--lib`, which is the
  # difference between a dex that runs and one that resolves at build time and
  # then cannot find `nts/rt/NtsRuntime` on the device. `times-on-device.sh`
  # passes it the same way; `dexes.sh` uses `--lib` because it only asks
  # whether d8 accepts the class file and never runs the result.
  set -- $(find "$work/build/classes" -name '*.class')
  if [ "$side" = nts ]; then
    set -- "$@" $(find "$work/nts-classes" -name '*.class') "$work/nts-classes/nts-runtime.jar"
  fi
  # shellcheck disable=SC2086
  # **`NTS_D8_RELEASE=1` dexes the way a shipped app is dexed.** `d8` defaults
  # to *debug* mode, which keeps local-variable scopes alive and pads with `nop
  # // spacer`. That costs this lane far more than it costs a hand-written
  # reference, because the classes this backend emits carry per-instruction
  # debug attributes by design -- `Towers$popDiskFrom` is 67 code units in
  # debug and 51 in release, where the reference's is 27 and 25. Same flag,
  # different penalty.
  # shellcheck disable=SC2086
  "$tools/d8" ${NTS_D8_RELEASE:+--release} --min-api 29 --lib "$plat" --output "$work/build/dex" "$@" \
    > "$work/d8-$side.log" 2>&1 || { echo "$side: d8"; sed -n 1,3p "$work/d8-$side.log"; return 1; }

  # The JIT number first, from the same dex, so the two modes differ in nothing
  # else. This is what `times-on-device.sh` measures.
  adb push "$work/build/dex/classes.dex" "/data/local/tmp/aot-$side.dex" > /dev/null 2>&1
  jit=$(adb shell "cd /data/local/tmp && dalvikvm -cp aot-$side.dex Case" 2>&1 \
        | awk 'NF >= 2 && $1 ~ /^[0-9.]+$/ { print $1 }')
  adb shell "rm -f /data/local/tmp/aot-$side.dex" > /dev/null 2>&1 || true

  "$tools/aapt2" link -I "$plat" --manifest "$work/AndroidManifest.xml" \
    --min-sdk-version 29 --target-sdk-version 29 -o "$work/build/base.apk" \
    > "$work/aapt-$side.log" 2>&1 || { echo "$side: aapt2"; return 1; }
  python3 - "$work/build" <<'PY'
import shutil, sys, zipfile
build = sys.argv[1]
shutil.copy(build + "/base.apk", build + "/with-dex.apk")
with zipfile.ZipFile(build + "/with-dex.apk", "a", zipfile.ZIP_DEFLATED) as apk:
    apk.write(build + "/dex/classes.dex", "classes.dex")
PY
  keytool -genkeypair -alias probe -keyalg RSA -keysize 2048 -validity 1 \
    -dname CN=probe -keystore "$work/build/ks.p12" -storetype PKCS12 \
    -storepass android -keypass android > /dev/null 2>&1
  "$tools/apksigner" sign --ks "$work/build/ks.p12" --ks-pass pass:android \
    --key-pass pass:android --out "$work/build/probe.apk" "$work/build/with-dex.apk" \
    > /dev/null 2>&1 || { echo "$side: apksigner"; return 1; }

  adb uninstall "$package" > /dev/null 2>&1 || true
  adb install "$work/build/probe.apk" > /dev/null 2>&1 \
    || { echo "$side: install"; return 1; }
  # **This is the step the whole script exists for.** `dex2oat`, run by the one
  # user that may. `-f` forces it even when the system thinks it is current.
  adb shell "cmd package compile -m speed -f $package" > "$work/compile-$side.log" 2>&1 \
    || { echo "$side: compile"; return 1; }
  compiled=$(sed -n 1,1p "$work/compile-$side.log")

  adb logcat -c > /dev/null 2>&1 || true
  adb shell "am start -n $package/.BenchActivity" > /dev/null 2>&1
  aot=""
  n=0
  while [ "$n" -lt 60 ]; do
    line=$(adb logcat -d -s NTSAOT 2>/dev/null | grep "RESULT" | tail -1)
    [ -n "$line" ] && { aot=$(printf '%s' "$line" | awk '{print $(NF-1)}'); break; }
    fail=$(adb logcat -d -s NTSAOT 2>/dev/null | grep "FAILED" | tail -1)
    [ -n "$fail" ] && { echo "$side: $fail" >&2; break; }
    n=$((n + 1))
    sleep 2
  done
  adb shell "am force-stop $package" > /dev/null 2>&1 || true
  # **`NTS_AOT_KEEP=1` leaves the package installed and dumps its AOT code.**
  #
  # This is the method-level view `benches/jvm-rows.md` records as unavailable.
  # It was unavailable because `dex2oat` cannot be run by the shell user -- and
  # what was never checked is that **`oatdump` can**. Once `cmd package compile`
  # has produced an `.odex`, the artefact is on disk and readable, so the thing
  # that was missing was something to produce it rather than something to read
  # it.
  if [ "${NTS_AOT_KEEP:-0}" != 0 ]; then
    # **`pm path`, not `find`.** `/data/app` is unlistable by the shell user --
    # `ls` on it is `Permission denied` -- so a `find` returns nothing and
    # reports it as "no artefact", which is the wrong conclusion from the right
    # error. The directory has traverse permission without read, so an *exact*
    # path works where a search does not, and `pm path` supplies it.
    apk=$(adb shell "pm path $package" 2>/dev/null | tr -d '\r' | sed 's|^package:||')
    odex=""
    [ -n "$apk" ] && odex=$(dirname "$apk")/oat/x86_64/base.odex
    if [ -n "$odex" ]; then
      echo "  $side odex: $odex" >&2
      # Read back that the compile happened, rather than trusting the exit
      # status of `cmd package compile`. `speed` is the filter asked for.
      adb shell "dumpsys package $package 2>/dev/null | grep -A1 'Dexopt state'" \
        | tr -d '\r' | sed "s/^/  $side /" >&2
      # No `head`: the OAT header alone is ~580 lines before any code, so a cap
      # small enough to feel safe returns a file with no disassembly in it and
      # nothing saying so. With a filter the whole dump is about 900 lines.
      #
      # `NTS_AOT_METHOD` picks the method, because the entry point is rarely
      # the interesting one -- the two lanes spell it differently (`work` here,
      # `run` there) and the hot method usually has the same name on both:
      # ours is the static `Towers$moveTopDisk` and the reference's is the
      # instance `Towers.moveTopDisk`, and `moveTopDisk` selects both.
      adb shell "oatdump --oat-file=$odex --method-filter=${NTS_AOT_METHOD:-$method} 2>&1" \
        | tr -d '\r' > "$work/oatdump-$side.txt" 2>&1
      echo "  $side dump: $work/oatdump-$side.txt ($(wc -l < "$work/oatdump-$side.txt") lines)" >&2
    else
      echo "  $side: no .odex found under /data/app" >&2
    fi
  else
    adb uninstall "$package" > /dev/null 2>&1 || true
  fi
  printf '%s %s %s\n' "${jit:-none}" "${aot:-none}" "${compiled:-?}"
}

printf "case %s, binary %s\n" "$case" "$(md5sum "$nts" | cut -c1-8)"
nts_line=$(build_and_run nts "$entry") || { echo "ours: $nts_line" >&2; exit 1; }
ref_line=$(build_and_run ref run) || { echo "reference: $ref_line" >&2; exit 1; }

set -- $nts_line; nts_jit=$1; nts_aot=$2
set -- $ref_line; ref_jit=$1; ref_aot=$2

printf "\n%-10s %14s %14s\n" "" "ours" "reference"
printf "%-10s %14s %14s\n" "JIT" "$nts_jit" "$ref_jit"
printf "%-10s %14s %14s\n" "AOT" "$nts_aot" "$ref_aot"
awk -v nj="$nts_jit" -v rj="$ref_jit" -v na="$nts_aot" -v ra="$ref_aot" '
  BEGIN {
    if (nj + 0 > 0 && rj + 0 > 0) printf "\nJIT ratio  %.2fx\n", nj / rj
    if (na + 0 > 0 && ra + 0 > 0) printf "AOT ratio  %.2fx\n", na / ra
    if (nj + 0 > 0 && rj + 0 > 0 && na + 0 > 0 && ra + 0 > 0)
      printf "the mode moves the ratio by %.2f\n", (na / ra) - (nj / rj)
  }'
