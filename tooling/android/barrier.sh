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
set -e

here=$(cd "$(dirname "$0")/../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$sdk" ] || { echo "no ANDROID_HOME" >&2; exit 1; }
tools=$(ls -d "$sdk"/build-tools/* | sort | tail -1)

adb wait-for-device
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex"

javac --release 8 -Xlint:-options -d "$work/classes" \
  "$here/compiler/codegen/jvm/tests/barrier/Barrier.java"
# shellcheck disable=SC2046
"$tools/d8" --min-api 26 --output "$work/dex" $(find "$work/classes" -name '*.class')
adb push "$work/dex/classes.dex" /data/local/tmp/barrier.dex > /dev/null

isa=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')
case "$isa" in
  arm64*) set_isa=arm64 ;;
  x86_64) set_isa=x86_64 ;;
  armeabi*) set_isa=arm ;;
  x86) set_isa=x86 ;;
  *) echo "unknown abi $isa" >&2; exit 1 ;;
esac
echo "device abi: $isa"

# **Where the ART tools live depends on the API level.** They moved into an
# APEX around API 30; on API 26 they are in `/system/bin` and there is no
# `dex2oat64` at all. This script named the APEX path only, so on the floor this
# library declares it compiled nothing, dumped nothing, and reported a barrier
# count of zero for both methods -- with the failure hidden because the command
# sends its errors to /dev/null.
compiler=""
dumper=""
for candidate in /apex/com.android.art/bin/dex2oat64 /apex/com.android.art/bin/dex2oat /system/bin/dex2oat; do
  if adb shell "test -x $candidate" 2>/dev/null; then compiler=$candidate; break; fi
done
for candidate in /apex/com.android.art/bin/oatdump /system/bin/oatdump; do
  if adb shell "test -x $candidate" 2>/dev/null; then dumper=$candidate; break; fi
done
[ -n "$compiler" ] && [ -n "$dumper" ] || {
  echo "FAILED: no dex2oat/oatdump on this device; looked in the APEX and /system/bin" >&2
  exit 1
}
echo "compiler: $compiler"

adb shell "$compiler \
  --dex-file=/data/local/tmp/barrier.dex \
  --oat-file=/data/local/tmp/barrier.oat \
  --instruction-set=$set_isa --compiler-filter=speed" > /dev/null 2>&1
adb shell "$dumper --oat-file=/data/local/tmp/barrier.oat \
  > /data/local/tmp/barrier.txt 2>&1"
adb pull /data/local/tmp/barrier.txt "$work/dump.txt" > /dev/null
adb shell rm -f /data/local/tmp/barrier.dex /data/local/tmp/barrier.oat /data/local/tmp/barrier.txt

# The code of one method runs from its `CODE:` line to the next method header.
extract() {
  awk -v want="$1" '
    $0 ~ ("void Barrier\\." want "\\(") { inside = 1 }
    inside && /CODE: \(code_offset/ { emitting = 1 }
    emitting { print }
    emitting && /ret[ \t]*$/ { exit }
  ' "$work/dump.txt"
}

volatile_code=$(extract publishVolatile)
plain_code=$(extract publishPlain)
[ -n "$volatile_code" ] && [ -n "$plain_code" ] || {
  echo "oatdump produced no native code for one of the probes -- dex2oat may have" >&2
  echo "verified rather than compiled, which it does for a foreign instruction set" >&2
  exit 1
}

# A barrier is a locked read-modify-write on x86 and a `dmb` on ARM. Matching
# either, because the point is that one has a fence and the other does not.
barriers() { printf '%s\n' "$1" | grep -cE 'lock[[:space:]]+(add|or|and)|dmb|mfence' || true; }
in_volatile=$(barriers "$volatile_code")
in_plain=$(barriers "$plain_code")

echo "publishVolatile: $in_volatile barrier(s)"
echo "publishPlain:    $in_plain barrier(s)"
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
