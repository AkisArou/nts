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
# `src/okhttp` too, and it was missing for the same reason and found the same
# way: `consumer-rules.pro` keeps `OkHttpNetworking`, this script never compiled
# it, and R8 said the rule matched nothing. That is the third time in this lane
# that the keep rules and the compiled source list have disagreed. The rule and
# the run are now wrong together or right together, which is the only
# arrangement that stays true.
#
# The pinned dependencies come from the cache the Rust suite fills, because that
# is where they are hash-verified against `dependencies.tsv`. Fetching them here
# as well would be a second, unverified way to get the same jars.
deps=${NTS_OKHTTP_DEPS:-${TMPDIR:-/tmp}/nts-okhttp-deps}
okhttp=$(ls "$deps"/okhttp-*.jar "$deps"/okio-*.jar "$deps"/kotlin-stdlib-*.jar 2>/dev/null | tr '\n' ':')
# `--lib` takes one file per flag, so the classpath form is no use to d8 or R8.
okhttp_libs=$(ls "$deps"/okhttp-*.jar "$deps"/okio-*.jar "$deps"/kotlin-stdlib-*.jar 2>/dev/null \
  | sed 's/^/--lib /' | tr '\n' ' ')
[ -n "$okhttp" ] || {
  echo "no pinned OkHttp jars in $deps -- run \`cargo test -p nts-codegen-jvm --test android\`" >&2
  echo "once to fetch and hash-verify them, or set NTS_OKHTTP_DEPS" >&2
  exit 1
}

# **Every source set, found rather than listed.** Naming them is what made
# forgetting one possible, three times over. A new one is in the build, in the
# dex and in the R8 input by construction.
sets=$(find "$here"/runtime/jvm/web-platform/android/src -name '*.java' | sort)
# shellcheck disable=SC2086
javac --release 8 -Xlint:-options -cp "$platform:$jar:$okhttp" -d "$work/classes" \
  $sets \
  "$here"/compiler/codegen/jvm/tests/env/RejectTest.java \
  "$here"/compiler/codegen/jvm/tests/env/EnvTest.java \
  "$here"/compiler/codegen/jvm/tests/env/CloseRaceTest.java \
  "$here"/compiler/codegen/jvm/tests/inbox/Stress.java

# shellcheck disable=SC2046
# shellcheck disable=SC2086
"$tools/d8" --min-api 26 --lib "$platform" $okhttp_libs --output "$work/dex" \
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
r8=$(ls "${TMPDIR:-/tmp}"/nts-okhttp-deps/r8-*.jar 2>/dev/null | tail -1)
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
  # is NTS-owned Java. Dexing OkHttp here would be measuring someone else's
  # artifact, which `the_pinned_dependencies_dex_at_the_same_api_floor` already
  # does on its own terms.
  # shellcheck disable=SC2086
  java -cp "$r8" com.android.tools.r8.R8 --release --min-api 26 --lib "$platform" \
    $okhttp_libs \
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
    "$here"/runtime/jvm/web-platform/android/src/test/java/org/nts/web/*.java
  # shellcheck disable=SC2046
  "$tools/d8" --min-api 26 --lib "$platform" --output "$work/testonly" \
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

# The two-adapter HTTP corpus, on the device.
#
# The desktop run proves the production adapter and the deterministic reference
# expose the same status, headers and body bytes. On ART it is a different
# OkHttp -- Conscrypt over BoringSSL rather than JSSE, a concurrent copying
# collector, and a dex that went through d8 -- so the transparent-decompression
# case is the one worth having here: the plan asks for device evidence that
# decompression cannot alter exposed headers unnoticed, and that is what this
# corpus is for.
#
# OkHttp goes in as an **input** here rather than as a library, because unlike
# the R8 run this dex has to actually execute it. That is the same distinction
# `the_pinned_dependencies_dex_at_the_same_api_floor` makes: shrink ours, run
# theirs.
mkdir -p "$work/http/classes" "$work/http/dex"
javac --release 8 -Xlint:-options -cp "$platform:$jar:$okhttp" -d "$work/http/classes" \
  "$here"/runtime/jvm/web-platform/android/src/okhttp/java/org/nts/web/*.java \
  "$here"/compiler/codegen/jvm/tests/android/BothHttp.java
# shellcheck disable=SC2046
"$tools/d8" --min-api 26 --lib "$platform" --output "$work/http/dex" \
  "$jar" $(ls "$deps"/okhttp-*.jar "$deps"/okio-*.jar "$deps"/kotlin-stdlib-*.jar) \
  $(find "$work/http/classes" -name '*.class')
adb push "$work/http/dex/classes.dex" /data/local/tmp/nts-bothhttp.dex > /dev/null
echo "--- BothHttp, both adapters over one server"
out=$(adb shell "CLASSPATH=/data/local/tmp/nts-bothhttp.dex app_process /data/local/tmp BothHttp" 2>&1)
echo "$out"
# The count, not only the zero: a corpus that stopped running half its cases
# reports no failures perfectly well.
case "$out" in *"94 checks, 0 failures"*) ;; *) failed=1 ;; esac
adb shell rm -f /data/local/tmp/nts-bothhttp.dex

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
