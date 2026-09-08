#!/bin/sh
# Does `volatile` actually reach the compiler and produce a barrier?
#
#     sh tooling/android/barrier.sh
#
# # What this is and is not
#
# `NtsInbox.Slot.next` is `volatile` because the link write is the publication
# edge that makes a worker's bytes visible to the owner lane. On x86 that
# keyword is **unfalsifiable by execution**: x86-TSO does not reorder stores
# with stores, so a build with it and a build without it behave identically on
# every input. `docs/records/0181` records three attempts at running the real
# thing on ARM and why none of them work on this machine.
#
# This is the other half, and it is checkable anywhere there is a device. It
# does not show the race; it shows that the **keyword reaches the compiler and
# produces a barrier**, which is the mechanism ARM correctness rests on. The
# JMM says the barrier is the compiler's obligation given the flag -- this
# checks that the compiler on the platform we ship to actually discharges it,
# rather than taking the specification's word for it.
#
# Two methods that differ only in the keyword, compiled by ART's own AOT
# compiler and disassembled by its own dumper. On x86_64 the barrier is
# `lock add [rsp], 0`; on ARM64 it would be `dmb ish`, which is why the check is
# for a barrier appearing in one and not the other rather than for a mnemonic.
#
# # Two methods, because the first one does not survive the floor
#
# The direct way is to compile *our own* probe with `dex2oat` on the device and
# dump that. It works on API 26 and **not on 29**: `/system/bin/dex2oat` is
# still there, but the shell cannot execute it -- `inaccessible or not found`
# for the binary that `ls` reports as present -- because it is reachable only
# from `installd`'s SELinux domain. Measured on both, rather than inferred from
# the APEX move, which happens later at API 30 and is a different thing.
#
# So when `dex2oat` is out of reach this reads the device's **boot image**
# instead, which needs only `oatdump` and that the shell can run. The pair there
# is chosen to differ in exactly one property:
#
#     void java.util.concurrent.atomic.AtomicInteger.set(int)   -- `volatile int value`
#       mov [rsi + 8], edx
#       lock add [rsp], 0             <- the StoreLoad fence
#       ret
#
#     void java.util.zip.Adler32.<init>()                       -- plain `int adler`
#       mov [rsi + 8], 1
#       ret
#
# The same store, to the same offset, in a two-instruction method, with and
# without the fence. `CharArrayWriter.reset` -- the control `arm-barrier.sh`
# uses -- is **not compiled** into the x86_64 boot image on API 29, and a
# control with no code would have made the volatile finding unfalsifiable.
#
# What is lost by the fallback is that the code is Android's rather than ours;
# what carries across is the compiler, which is the thing under question. The
# script says which method produced its answer, because the two are not equally
# strong evidence and a reader should not have to guess.
set -e

here=$(cd "$(dirname "$0")/../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$sdk" ] || { echo "no ANDROID_HOME" >&2; exit 1; }
tools=$(ls -d "$sdk"/build-tools/* | sort | tail -1)

adb wait-for-device
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex"

isa=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')
case "$isa" in
  arm64*) set_isa=arm64 ;;
  x86_64) set_isa=x86_64 ;;
  armeabi*) set_isa=arm ;;
  x86) set_isa=x86 ;;
  *) echo "unknown abi $isa" >&2; exit 1 ;;
esac
echo "device abi: $isa"

# **Where the ART tools live, and which of them the shell may run.** They move
# into an APEX at API 30; on 26 and 29 both are in `/system/bin`. But presence
# is not permission: on 29 `dex2oat` is there and `test -x` says no, so the
# candidate loop below decides the *method* rather than just the path. An
# earlier version named the APEX path only, compiled nothing, dumped nothing,
# and reported a barrier count of zero for both methods -- with the failure
# hidden because the command sends its errors to /dev/null.
compiler=""
dumper=""
for candidate in /apex/com.android.art/bin/dex2oat64 /apex/com.android.art/bin/dex2oat /system/bin/dex2oat; do
  if adb shell "test -x $candidate" 2>/dev/null; then compiler=$candidate; break; fi
done
for candidate in /apex/com.android.art/bin/oatdump /system/bin/oatdump; do
  if adb shell "test -x $candidate" 2>/dev/null; then dumper=$candidate; break; fi
done
[ -n "$dumper" ] || {
  echo "FAILED: no oatdump on this device; looked in the APEX and /system/bin" >&2
  exit 1
}

# The code of one method: from its `CODE:` line to the `ret` that ends it. The
# header is matched rather than the bare name, because a name also appears in
# every *other* method's dex listing as an invoke target.
code_of() {
  awk -v want="$1" '
    index($0, want) && index($0, "dex_method_idx=") { armed = 1 }
    armed && /CODE: \(code_offset/ { emitting = 1; next }
    emitting { print }
    emitting && /ret[ \t]*$/ { exit }
  ' "$2"
}

if [ -n "$compiler" ]; then
  method="our own probe, compiled on the device by $compiler"
  javac --release 8 -Xlint:-options -d "$work/classes" \
    "$here/compiler/codegen/jvm/tests/barrier/Barrier.java"
  # **The device's level, not the library's floor.** This probe is a test class
  # that has to load on whatever is attached; it ships nowhere. Dexing it at 29
  # made it unloadable on an API-26 device, whose `dex2oat` then refused it --
  # and that is the one device where the strong method still works, so the
  # number that is about our floor was quietly disabling the better evidence.
  # shellcheck disable=SC2046
  "$tools/d8" --min-api "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" \
    --output "$work/dex" $(find "$work/classes" -name '*.class')
  adb push "$work/dex/classes.dex" /data/local/tmp/barrier.dex > /dev/null
  adb shell "$compiler \
    --dex-file=/data/local/tmp/barrier.dex \
    --oat-file=/data/local/tmp/barrier.oat \
    --instruction-set=$set_isa --compiler-filter=speed" > /dev/null 2>&1
  adb shell "$dumper --oat-file=/data/local/tmp/barrier.oat \
    > /data/local/tmp/barrier.txt 2>&1"
  adb pull /data/local/tmp/barrier.txt "$work/dump.txt" > /dev/null
  adb shell rm -f /data/local/tmp/barrier.dex /data/local/tmp/barrier.oat /data/local/tmp/barrier.txt
  volatile_code=$(code_of "void Barrier.publishVolatile(" "$work/dump.txt")
  plain_code=$(code_of "void Barrier.publishPlain(" "$work/dump.txt")
  missing="oatdump produced no native code for one of the probes -- dex2oat may have
verified rather than compiled, which it does for a foreign instruction set"
else
  # `dex2oat` is present and out of reach, which is the API-29 case. Announced,
  # not silent: this is weaker evidence and the difference is the whole point.
  echo "note: $set_isa dex2oat is not executable from the shell on this device;"
  echo "      reading the boot image instead, which needs only oatdump"
  boot=""
  for candidate in \
    "/system/framework/$set_isa/boot.oat" \
    "/apex/com.android.art/javalib/$set_isa/boot.oat" \
    "/data/dalvik-cache/$set_isa/system@framework@boot.art"; do
    if adb shell "test -r $candidate" 2>/dev/null; then boot=$candidate; break; fi
  done
  [ -n "$boot" ] || { echo "FAILED: no readable boot image for $set_isa" >&2; exit 1; }
  method="the device's own boot image at $boot"
  # One dump per class: the filter is what keeps this to seconds rather than
  # the whole framework.
  adb shell "$dumper --oat-file=$boot \
    --class-filter=java.util.concurrent.atomic.AtomicInteger 2>/dev/null" \
    | tr -d '\r' > "$work/volatile.txt"
  adb shell "$dumper --oat-file=$boot --class-filter=java.util.zip.Adler32 2>/dev/null" \
    | tr -d '\r' > "$work/plain.txt"
  volatile_code=$(code_of "void java.util.concurrent.atomic.AtomicInteger.set(int)" "$work/volatile.txt")
  plain_code=$(code_of "void java.util.zip.Adler32.<init>()" "$work/plain.txt")
  missing="the boot image has no compiled code for one of the two probes, so the
comparison would say nothing. A boot image built with a different profile may
simply not contain them; pick another pair rather than trusting a one-sided
result."
fi

echo "measured from: $method"
[ -n "$volatile_code" ] && [ -n "$plain_code" ] || {
  echo "FAILED: $missing" >&2
  exit 1
}

# A barrier is a locked read-modify-write on x86 and a `dmb` on ARM. Matching
# either, because the point is that one has a fence and the other does not.
barriers() { printf '%s\n' "$1" | grep -cE 'lock[[:space:]]+(add|or|and)|dmb|mfence' || true; }
in_volatile=$(barriers "$volatile_code")
in_plain=$(barriers "$plain_code")

echo "volatile store: $in_volatile barrier(s)"
echo "plain store:    $in_plain barrier(s)"
printf '%s\n' "$volatile_code" | tail -4

if [ "$in_volatile" -lt 1 ]; then
  echo "FAILED: a store to a volatile field compiled without a barrier" >&2
  exit 1
fi
if [ "$in_plain" -ne 0 ]; then
  echo "FAILED: a store to a plain field compiled with a barrier, so the presence" >&2
  echo "of one in the volatile case says nothing about the keyword" >&2
  exit 1
fi
echo "barrier: present for volatile, absent for plain, on $set_isa"
