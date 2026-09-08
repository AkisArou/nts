#!/bin/sh
# Run the JVM lane's Java suites on a real Android device or emulator.
#
# The desktop suites run on OpenJDK: HotSpot, JSSE, and a stop-the-world
# collector. A device runs ART, Conscrypt over BoringSSL, and a concurrent
# copying collector with read barriers. Those are different implementations of
# every primitive this lane depends on, and the difference is not theoretical --
# the first device run found a reachability test that could never pass on ART,
# because polling `WeakReference.get()` is what kept the object alive.
#
# Needs: ANDROID_HOME with build-tools and a platform, a JDK, and one device
# visible to `adb`. Usage:
#
#     sh tooling/android/on-device.sh
#
# `app_process` and not `dalvikvm`: Conscrypt's handshake metrics call
# `SystemClock.elapsedRealtimeNanos`, which is a framework native that
# `dalvikvm` does not link, so every TLS case dies on a stack trace about
# statistics. `app_process` loads the framework and they pass.
set -e

here=$(cd "$(dirname "$0")/../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$sdk" ] || { echo "no ANDROID_HOME"; exit 1; }
tools=$(ls -d "$sdk"/build-tools/* | sort | tail -1)
platform=$(ls -d "$sdk"/platforms/* | sort | tail -1)/android.jar
[ -x "$tools/d8" ] || { echo "no d8 in $tools"; exit 1; }

adb wait-for-device
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex"

jar="$here/runtime/jvm/nts-runtime.jar"
# `src/android` too, and it was missing. Without it `AndroidNetworking` is not
# in the R8 input, so its keep rule matches nothing -- which R8 says out loud
# and this script scrolled past:
#
#   Proguard configuration rule does not match anything:
#     `-keep class org.nts.web.AndroidNetworking { public *; }`
#
# One of the three rules was guarding a class that was never there.
#

# **Every source set, found rather than listed.** Naming them is what made
# forgetting one possible, three times over. A new one is in the build, in the
# dex and in the R8 input by construction.
sets=$(find "$here"/runtime/jvm/web-platform/android/src -name '*.java' | sort)
# shellcheck disable=SC2086
javac --release 8 -Xlint:-options -cp "$platform:$jar" -d "$work/classes" \
  $sets \
  "$here"/compiler/codegen/jvm/tests/env/RejectTest.java \
  "$here"/compiler/codegen/jvm/tests/env/EnvTest.java \
  "$here"/compiler/codegen/jvm/tests/env/CloseRaceTest.java \
  "$here"/compiler/codegen/jvm/tests/inbox/Stress.java \
  "$here"/compiler/codegen/jvm/tests/store/StoreTest.java

# shellcheck disable=SC2046
# shellcheck disable=SC2086
"$tools/d8" --min-api 29 --lib "$platform" --output "$work/dex" \
  "$jar" $(find "$work/classes" -name '*.class')

# The certificate names the *address*, because the imported suite connects to
# `127.0.0.1` and requires `localhost` to be refused. `transport.rs` generates
# the mirror of this for its own suite; see the note there.
# The **legacy** PKCS12 algorithms, and this is an API-29 finding rather than a
# preference. A modern `keytool` writes PBES2 with `HmacPBESHA256`, and API 29's
# bundled BouncyCastle cannot read that MAC:
#
#   java.io.IOException: PKCS12 key store mac invalid - wrong password or
#                        corrupted file.
#     at com.android.org.bouncycastle...PKCS12KeyStoreSpi.engineLoad
#
# The device suite passed for as long as it only ran on API 36, whose Conscrypt
# handles it. On the floor this library actually declares, every TLS case died
# before the first handshake -- and `app_process` reports that as `Killed` with
# the exception only in logcat, so the run looked like a hang.
#
# These three are what API 29 accepts. They are weak, and that is fine for a
# certificate generated per run, valid for one day, for a loopback peer.
keytool -genkeypair -alias nts-web -keyalg RSA -keysize 2048 -validity 1 \
  -J-Dkeystore.pkcs12.macAlgorithm=HmacPBESHA1 \
  -J-Dkeystore.pkcs12.keyProtectionAlgorithm=PBEWithSHA1AndDESede \
  -J-Dkeystore.pkcs12.certProtectionAlgorithm=PBEWithSHA1AndRC2_40 \
  -dname CN=nts-web-test -ext SAN=ip:127.0.0.1 \
  -keystore "$work/store.p12" -storetype PKCS12 \
  -storepass test-only -keypass test-only > /dev/null

adb push "$work/dex/classes.dex" /data/local/tmp/nts-device.dex > /dev/null
adb push "$work/store.p12" /data/local/tmp/store.p12 > /dev/null

failed=0
run() {
  echo "--- $1"
  # `|| true`, because `set -e` is on and a command substitution that exits
  # non-zero kills the script. A case that *crashes* on the device -- which is
  # what a `NoSuchMethodError` does -- would otherwise stop the suite where it
  # stood, printing nothing about why and leaving every later case unrun. That
  # happened, and the exit code was 137 with no failing case named.
  out=$(adb shell "CLASSPATH=/data/local/tmp/nts-device.dex app_process /data/local/tmp $1 $2" 2>&1) || true
  echo "$out"
  case "$out" in
    *"0 failures"*|*"PASS:"*) ;;
    *) failed=1 ;;
  esac
}

# The durable store on ART. It names no SDK member, so this is the same class
# the desktop suite runs -- and that is the point: atomic rename, both syncs and
# the name encoding are filesystem behaviour, and the filesystem under ART is
# not the one under a desktop JDK.
run StoreTest /data/local/tmp/nts-store

run org.nts.web.NetworkPrimitivesTest /data/local/tmp/store.p12
# Which default-network events mean the open sockets are dead. The decision runs
# on a desktop too; what a device adds is that it runs on ART, in the same dex
# as the callback that will drive it.
run org.nts.web.DefaultNetworkWatchTest
run RejectTest
run EnvTest
run CloseRaceTest
run Stress

# And again against an R8-shrunk library, which is what actually ships. D8 only
# translates; R8 also removes, and every entry point here is called from
# outside Java, so R8 can see a path to none of them -- `consumer-rules.pro` is
# the only reason the artifact still has a surface. Running the same suite
# against the shrunk output is the difference between the rules being present
# and the rules being right.
#
# Uses the jar the Rust suite pins and caches; skipped rather than fetched here,
# because a shell script downloading a build tool is a supply-chain decision
# that belongs where the digests are.
r8=$(ls "${TMPDIR:-/tmp}"/nts-android-tools/r8-*.jar 2>/dev/null | tail -1)
if [ -n "$r8" ]; then
  mkdir -p "$work/shrunk" "$work/testonly"
  # shellcheck disable=SC2046
  # A keep rule that matches nothing is a hole, not a warning: it reads as
  # protection and protects nothing, and the class it named is gone from the
  # artifact. So it fails the run.
  #
  # Both streams. R8 prints this on **stdout**, and capturing only stderr made
  # the check pass for a rule naming a class that does not exist -- a check
  # that could not fail, guarding against checks that cannot fail.
  # The third-party jars as libraries rather than inputs: what is being shrunk
  # is NTS-owned Java and there is nothing else on the path any more.
  # artifact, which `the_pinned_dependencies_dex_at_the_same_api_floor` already
  # does on its own terms.
  # shellcheck disable=SC2086
  java -cp "$r8" com.android.tools.r8.R8 --release --min-api 29 --lib "$platform" \
    \
    --pg-conf "$here/runtime/jvm/web-platform/android/consumer-rules.pro" \
    --output "$work/shrunk" \
    $(find "$work/classes" -path '*org/nts/web/*' -name '*.class') > "$work/r8.log" 2>&1 || {
      cat "$work/r8.log" >&2; exit 1; }
  if grep -q "does not match anything" "$work/r8.log"; then
    echo "FAILED: a keep rule in consumer-rules.pro matches nothing" >&2
    grep -A 2 "does not match anything" "$work/r8.log" >&2
    exit 1
  fi
  javac --release 8 -Xlint:-options -cp "$platform:$work/classes" -d "$work/testonly" \
    "$here"/runtime/jvm/web-platform/android/src/test/java/org/nts/web/*.java \
    "$here"/runtime/jvm/web-platform/android/src/androidTest/java/org/nts/web/*.java
  # shellcheck disable=SC2046
  "$tools/d8" --min-api 29 --lib "$platform" --output "$work/testonly" \
    $(find "$work/testonly" -name '*.class')
  adb push "$work/shrunk/classes.dex" /data/local/tmp/nts-shrunk.dex > /dev/null
  adb push "$work/testonly/classes.dex" /data/local/tmp/nts-testonly.dex > /dev/null
  echo "--- org.nts.web.NetworkPrimitivesTest, against the R8-shrunk library"
  out=$(adb shell "CLASSPATH=/data/local/tmp/nts-testonly.dex:/data/local/tmp/nts-shrunk.dex app_process /data/local/tmp org.nts.web.NetworkPrimitivesTest /data/local/tmp/store.p12" 2>&1)
  echo "$out"
  case "$out" in *"PASS:"*) ;; *) failed=1 ;; esac
  adb shell rm -f /data/local/tmp/nts-shrunk.dex /data/local/tmp/nts-testonly.dex
else
  echo "--- no cached R8; run \`cargo test -p nts-codegen-jvm --test android\` first to pin and fetch it"
fi

# Does `ConnectivityManager` deliver, and is the first network not a change?
#
# The registration half of `watchDefaultNetwork`, which no desktop test can
# show. **Bounded with `timeout` anyway**, because this file spent a day
# looking like a device-state problem: it printed every check as passing and
# then never exited, the harness killed it, and a killed process is the one
# whose `ConnectivityManager` registrations are never reclaimed. Twenty
# `TRACK_DEFAULT` requests owned by dead root pids, four per killed run, and
# every one of them a consequence of the hang rather than its cause. The cause
# was a missing `System.exit`; with it, five consecutive runs take three
# seconds each on the device still holding those twenty.
#
# The bound stays because a suite that can hang is worse than one that can
# skip, not because the hang is expected.
echo "--- org.nts.web.DefaultNetworkDeliveryTest"
out=$(timeout 150 adb shell "CLASSPATH=/data/local/tmp/nts-device.dex app_process /data/local/tmp org.nts.web.DefaultNetworkDeliveryTest" 2>&1)
echo "$out"
# Cased on what the run *said*, not on what `adb shell` returned: it exits
# non-zero here for reasons that have nothing to do with the test, and an
# earlier version of this printed "timed out" underneath a passing result.
case "$out" in
  *"FAIL "*) failed=1 ;;
  *"0 failures"*) ;;
  *"SKIP delivery"*) ;;
  *) echo "SKIP delivery: no result in 150s -- leaked TRACK_DEFAULT registrations hang the" \
       "call rather than failing it; \`dumpsys connectivity | grep -c TRACK_DEFAULT\` is the" \
       "count and rebooting the emulator clears it" ;;
esac

# **There is no handover case here, and that is a decision.** A real Wi-Fi to
# cellular transition *is* producible on this emulator -- it carries both
# networks, and taking `wlan0` down moves the default from one to the other --
# and a test that did it observed `watchDefaultNetwork` sweep the open
# connections, with the sabotage that removes the registration leaving three
# open. That measurement happened.
#
# It is not here because it did not happen *twice*. The same test then hung,
# from its own dex and from this one, wedged `adb` repeatedly, and left the
# device with no Wi-Fi when killed. A case that cannot be run twice in a row is
# not evidence a suite can carry, whatever it showed once. See
# `docs/records/0200`.

# Does `volatile` reach ART's compiler and produce a barrier?
#
# The half of `docs/records/0181` that is checkable without ARM. It does not
# show the race -- x86-TSO does not reorder stores with stores, so the keyword
# is unfalsifiable by execution here -- it shows that the compiler on the
# platform we ship to discharges the obligation the JMM gives it, rather than
# taking the specification's word for it.
#
# It has its own dex and its own device round trip, so it runs as a script
# rather than as another `run` line. It was written before there was a device
# to run it on and had never been executed until today.
echo "--- volatile barrier, through ART's own compiler"
if sh "$here/tooling/android/barrier.sh"; then :; else failed=1; fi

adb shell rm -f /data/local/tmp/nts-device.dex /data/local/tmp/store.p12
[ "$failed" -eq 0 ] || { echo "device run failed"; exit 1; }
echo "device: every suite green on ART"
