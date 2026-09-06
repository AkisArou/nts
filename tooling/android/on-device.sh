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
javac --release 8 -Xlint:-options -cp "$platform:$jar" -d "$work/classes" \
  "$here"/runtime/web-platform/android/src/main/java/org/nts/web/*.java \
  "$here"/runtime/web-platform/android/src/test/java/org/nts/web/*.java \
  "$here"/compiler/codegen/jvm/tests/env/EnvTest.java \
  "$here"/compiler/codegen/jvm/tests/env/CloseRaceTest.java \
  "$here"/compiler/codegen/jvm/tests/inbox/Stress.java

# shellcheck disable=SC2046
"$tools/d8" --min-api 26 --lib "$platform" --output "$work/dex" \
  "$jar" $(find "$work/classes" -name '*.class')

# The certificate names the *address*, because the imported suite connects to
# `127.0.0.1` and requires `localhost` to be refused. `transport.rs` generates
# the mirror of this for its own suite; see the note there.
keytool -genkeypair -alias nts-web -keyalg RSA -keysize 2048 -validity 1 \
  -dname CN=nts-web-test -ext SAN=ip:127.0.0.1 \
  -keystore "$work/store.p12" -storetype PKCS12 \
  -storepass test-only -keypass test-only > /dev/null

adb push "$work/dex/classes.dex" /data/local/tmp/nts-device.dex > /dev/null
adb push "$work/store.p12" /data/local/tmp/store.p12 > /dev/null

failed=0
run() {
  echo "--- $1"
  out=$(adb shell "CLASSPATH=/data/local/tmp/nts-device.dex app_process /data/local/tmp $1 $2" 2>&1)
  echo "$out"
  case "$out" in
    *"0 failures"*|*"PASS:"*) ;;
    *) failed=1 ;;
  esac
}

run org.nts.web.NetworkPrimitivesTest /data/local/tmp/store.p12
run EnvTest
run CloseRaceTest
run Stress

adb shell rm -f /data/local/tmp/nts-device.dex /data/local/tmp/store.p12
[ "$failed" -eq 0 ] || { echo "device run failed"; exit 1; }
echo "device: every suite green on ART"
