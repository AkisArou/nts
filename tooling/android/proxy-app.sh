#!/bin/sh
# What a *real app* is told about the system proxy.
#
#     sh tooling/android/proxy-app.sh
#
# # Why this exists and `app_process` was not enough
#
# The provider asks `ProxySelector.getDefault().select(uri)`, and everything
# that answers depends on system properties the **framework** sets when an
# application process starts. A bare `app_process` never runs that path, so
# every proxy measurement taken through one is about `DefaultProxySelector`
# reading properties nobody set — true, and about the selector rather than about
# the device.
#
# So this installs an actual APK, sets the device's global proxy, launches it,
# and reads what the process was given. It is the only measurement in this lane
# that exercises the path from a device setting to a running program.
#
# # What it found, which is a correction rather than a confirmation
#
# On API 26 the framework propagates the proxy **host and port** to a real app
# and does **not** propagate the exclusion list:
#
#     global_http_proxy_exclusion_list = localhost,127.0.0.1   (verified set)
#     http.nonProxyHosts               =                        (empty)
#     http://127.0.0.1:8080/b          -> PROXY proxy.test:3128
#
# **A loopback request goes to the proxy.** So shared code cannot rely on the
# platform applying a bypass list, and the no-proxy list applied above the seam
# is load-bearing rather than defensive. An earlier measurement of mine said the
# opposite, because it set `http.nonProxyHosts` by hand and then observed that
# the selector honoured it — which is a fact about the selector and not about
# what a device gives it.
#
# # The ordering trap, recorded because it cost two runs
#
# `settings put global http_proxy host:port` **clears**
# `global_http_proxy_exclusion_list`. Setting the list first and the proxy
# second leaves the list empty, and the empty list then looks like a platform
# finding rather than a configuration mistake. The list is set second here.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
plat=$sdk/platforms/android-26/android.jar
work=${NTS_PROXY_APP_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/nts/proxy-app}
app=$here/compiler/codegen/jvm/tests/android/proxy-app
package=org.nts.proxyprobe

command -v adb > /dev/null 2>&1 || { echo "SKIP proxy-app: no adb" >&2; exit 0; }
adb get-state > /dev/null 2>&1 || { echo "SKIP proxy-app: no device" >&2; exit 0; }
[ -f "$plat" ] || { echo "SKIP proxy-app: no android-26 platform jar" >&2; exit 0; }
tools=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort | tail -1)
[ -n "$tools" ] || { echo "SKIP proxy-app: no build-tools" >&2; exit 0; }
command -v keytool > /dev/null 2>&1 || { echo "SKIP proxy-app: no keytool" >&2; exit 0; }

rm -rf "$work"
mkdir -p "$work/classes" "$work/dex"
"$tools/aapt2" link -I "$plat" --manifest "$app/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 26 -o "$work/base.apk"
javac --release 8 -Xlint:-options -cp "$plat" -d "$work/classes" \
  $(find "$app/java" -name '*.java')
"$tools/d8" --min-api 26 --lib "$plat" --output "$work/dex" \
  $(find "$work/classes" -name '*.class')
# `python3` rather than `zip`, which is not installed here and is one more thing
# a fresh machine would have to have.
python3 - "$work" <<'PY'
import shutil, sys, zipfile
work = sys.argv[1]
shutil.copy(work + "/base.apk", work + "/with-dex.apk")
with zipfile.ZipFile(work + "/with-dex.apk", "a", zipfile.ZIP_DEFLATED) as apk:
    apk.write(work + "/dex/classes.dex", "classes.dex")
PY
keytool -genkeypair -alias probe -keyalg RSA -keysize 2048 -validity 1 \
  -dname CN=probe -keystore "$work/ks.p12" -storetype PKCS12 \
  -storepass android -keypass android > /dev/null 2>&1
"$tools/apksigner" sign --ks "$work/ks.p12" --ks-pass pass:android \
  --key-pass pass:android --out "$work/probe.apk" "$work/with-dex.apk"
# Uninstalled first: the keystore is generated per run, so a probe left over
# from a previous one is signed by a different key and `install -r` refuses it.
adb uninstall "$package" > /dev/null 2>&1 || true
adb install "$work/probe.apk" > /dev/null 2>&1 \
  || { echo "FAILED: could not install the probe" >&2; exit 1; }

# One run, from a fresh process: the properties are read at process start, so a
# reused one would answer about the previous configuration.
run() {
  adb shell am force-stop "$package" > /dev/null 2>&1
  sleep 1
  adb logcat -c > /dev/null 2>&1 || true
  adb shell am start -n "$package/.ProbeActivity" > /dev/null 2>&1
  sleep 4
  adb logcat -d -s NtsProxyProbe:I 2>/dev/null | sed 's/.*NtsProxyProbe: //'
}

setting() { adb shell settings get global "$1" 2>/dev/null | tr -d '\r'; }

status=0

echo "--- with no proxy configured"
adb shell "settings put global http_proxy ':0'" > /dev/null 2>&1
sleep 2
none=$(run)
echo "$none" | grep -E "proxyHost=|remote=|loopback=" | sed 's/^/  /'
echo "$none" | grep -q "remote=DIRECT" || {
  echo "FAILED: no proxy configured and the app was still given one" >&2
  status=1
}

echo "--- with a global proxy and an exclusion list"
# The proxy first: setting `http_proxy` clears the exclusion list, so the other
# order silently measures an empty list.
adb shell "settings put global http_proxy proxy.test:3128" > /dev/null 2>&1
adb shell "settings put global global_http_proxy_exclusion_list localhost,127.0.0.1" \
  > /dev/null 2>&1
sleep 2
echo "  configured: http_proxy=[$(setting http_proxy)] exclusion=[$(setting global_http_proxy_exclusion_list)]"
[ "$(setting global_http_proxy_exclusion_list)" = "localhost,127.0.0.1" ] || {
  echo "FAILED: the exclusion list did not take, so the run below measures nothing" >&2
  status=1
}
set_=$(run)
echo "$set_" | grep -E "proxyHost=|remote=|loopback=" | sed 's/^/  /'

# **The path itself**, which is the thing `app_process` could not show.
echo "$set_" | grep -q "remote=PROXY proxy.test:3128" || {
  echo "FAILED: a device proxy setting did not reach a running app" >&2
  status=1
}

# And whether the platform bypasses loopback. Reported rather than required in
# one direction: a later Android that propagates the list would answer DIRECT,
# and that is an improvement rather than a regression. What is asserted is that
# the two halves agree -- an empty `nonProxyHosts` with a bypassed loopback, or
# a populated one with a proxied loopback, would mean the property is not what
# decides it and everything above would be built on the wrong thing.
if echo "$set_" | grep -q "nonProxyHosts=$"; then
  echo "  the exclusion list did NOT reach the app, and loopback is proxied"
  echo "$set_" | grep -q "loopback=PROXY" || {
    echo "FAILED: no bypass list arrived yet loopback was not proxied" >&2
    status=1
  }
else
  echo "  the exclusion list reached the app; loopback should be direct"
  echo "$set_" | grep -q "loopback=DIRECT" || {
    echo "FAILED: a bypass list arrived and loopback was proxied anyway" >&2
    status=1
  }
fi

adb shell "settings put global http_proxy ':0'" > /dev/null 2>&1
adb uninstall "$package" > /dev/null 2>&1 || true
[ "$status" = 0 ] || exit 1
echo "proxy-app: a device setting reaches a real app; the bypass list does not"
