#!/bin/sh
# Does ART's **arm64** compiler discharge the publication obligation?
#
#     sh tooling/android/arm-barrier.sh
#
# `barrier.sh` beside this asks the same question of the x86_64 compiler and
# answers it with `lock add [rsp], 0`. This one asks it of ARM64, which is the
# architecture `docs/records/0181` is actually about -- x86-TSO does not reorder
# stores, so the keyword is unfalsifiable by execution there and the whole
# argument for the barrier lives on a machine we do not have.
#
# # What this is, and three things it is not
#
# It disassembles ART's own arm64 boot image and compares a method that writes a
# **volatile** field against one that writes a plain field:
#
#     void java.util.concurrent.atomic.AtomicInteger.set(int)   -- `volatile int value`
#       stlr w2, [x16]                <- store-release
#       ret
#
#     void java.io.CharArrayWriter.reset()                      -- plain `int count`
#       str wzr, [x1, #20]            <- plain store
#       ret
#
# `stlr` is ARM64's release store. That is the publication edge, emitted for the
# volatile write and not for the plain one, by the compiler that ships on the
# platform this lane targets.
#
# **It is not the race.** Showing that a reader can observe a half-published
# object without the barrier needs two cores executing ARM64 concurrently, and
# there is no ARM device or host here -- QEMU2 refuses an arm64 guest on an
# x86_64 host. This is the compiler's half.
#
# **It is not our code.** `dex2oat` under `qemu-user` will not cross-compile a
# dex here: it opens the file, closes it, and exits, and its diagnostics go to a
# `logd` that does not exist in a user-mode sysroot -- `/dev/socket/logdw` is
# probed and absent 1,092 times in one run. So the evidence is Android's own
# compiled code rather than `NtsInbox`. What carries across is the *compiler*,
# which is the thing under question.
#
# **It is not a substitute for `Stress`'s reflection check.** That one asserts
# our field is still declared `volatile`; this one asserts what ART does with a
# field that is. Neither implies the other, and both are cheap.
#
# # Why user-mode emulation is enough
#
# Nothing here executes ARM64 code that matters. `oatdump` runs under
# `qemu-aarch64-static` purely to read a file and print text; the ARM64 code it
# prints was compiled by Google, for a real device, and is being read rather
# than run. An emulator that got the *semantics* of ARM64 wrong would still
# print the same bytes.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
# **26 on purpose, though the lane's floor is 29.** This measures what ART's
# arm64 compiler does with a volatile field, which is a fact about ART and not
# a claim about the API level we ship to -- and 26 is the arm64 image already
# on disk. A 29 image would answer the same question at 2.5 GB more.
image=$sdk/system-images/android-26/google_apis/arm64-v8a/system.img
# **Not `$TMPDIR`.** Extracting this needs a 2.5 GB intermediate and leaves 331
# MB behind, and `/tmp` here is `tmpfs` -- so the default would spend that in
# RAM and hit a quota rather than a disk. A cache directory is also the honest
# description of it: it is derived from an SDK image, reused across runs, and
# safe to delete.
root=${NTS_ARM64_SYSROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/nts/arm64-sysroot}

# Announced, every one of them: a skip that prints nothing reads as a pass, and
# this is the only ARM evidence this lane has.
command -v qemu-aarch64-static > /dev/null 2>&1 || {
  echo "SKIP arm-barrier: no qemu-aarch64-static; install qemu-user-static" >&2
  exit 0
}
command -v debugfs > /dev/null 2>&1 || {
  echo "SKIP arm-barrier: no debugfs to read the system image with" >&2
  exit 0
}
[ -f "$image" ] || {
  echo "SKIP arm-barrier: no arm64-v8a system image at $image" >&2
  echo "  sdkmanager 'system-images;android-26;google_apis;arm64-v8a'" >&2
  exit 0
}

# The sysroot is cached: extracting it is 336 MB of `debugfs` and takes long
# enough that re-doing it per run would make this the slowest step in the lane.
if [ ! -x "$root/system/bin/oatdump" ]; then
  echo "extracting the arm64 sysroot to $root (once)"
  rm -rf "$root"
  mkdir -p "$root/system"
  # The image is GPT with one ext4 partition at sector 2048. `debugfs` reads
  # ext4 without mounting, which is what keeps this from needing root.
  # The intermediate lives beside the sysroot rather than in `$TMPDIR`, for the
  # same reason, and goes away as soon as `debugfs` has read it.
  dd if="$image" of="$root/system.raw" bs=512 skip=2048 status=none
  for dir in bin lib64 framework; do
    debugfs -R "rdump /$dir $root/system" "$root/system.raw" > /dev/null 2>&1
  done
  rm -f "$root/system.raw"
fi

boot=$root/system/framework/arm64/boot.oat
[ -f "$boot" ] || { echo "FAILED: no arm64 boot.oat under $root" >&2; exit 1; }

dump() {
  qemu-aarch64-static -L "$root" "$root/system/bin/oatdump" \
    --oat-file="$boot" --class-filter="$1" 2>/dev/null
}

# One method's native code: from its `CODE:` line to the `ret` that ends it.
code_of() {
  awk -v want="$1" '
    index($0, want) { armed = 1 }
    armed && /CODE: \(code_offset/ { emitting = 1; next }
    emitting { print }
    emitting && /\tret$/ { exit }
  '
}

volatile_write=$(dump java.util.concurrent.atomic.AtomicInteger \
  | code_of "void java.util.concurrent.atomic.AtomicInteger.set(int)")
plain_write=$(dump java.io.CharArrayWriter \
  | code_of "void java.io.CharArrayWriter.reset()")

[ -n "$volatile_write" ] && [ -n "$plain_write" ] || {
  echo "FAILED: oatdump produced no code for one of the two probes" >&2
  echo "  the boot image may have been built with a different compiler filter" >&2
  exit 1
}

echo "volatile write -- AtomicInteger.set(int):"
echo "$volatile_write" | sed 's/^/  /'
echo "plain write -- CharArrayWriter.reset():"
echo "$plain_write" | sed 's/^/  /'

status=0
echo "$volatile_write" | grep -q "stlr" || {
  echo "FAILED: a volatile write compiled without a release store on arm64" >&2
  status=1
}
echo "$plain_write" | grep -qE "stlr|dmb" && {
  echo "FAILED: a plain write compiled with a barrier, so the comparison says nothing" >&2
  status=1
}
[ "$status" = 0 ] || exit 1

echo "arm64: release store for volatile, plain store for plain -- ART's own compiler"
