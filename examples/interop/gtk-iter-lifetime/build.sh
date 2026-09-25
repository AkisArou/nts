#!/bin/sh
# A buffer whose last use precedes its iterators' (src/main.ts), and an
# iterator that escapes its buffer's block (escape/src/main.ts), each built as
# a C and an LLVM product, plain and under reference counting, and run with
# GTK's warnings fatal: an iterator into a freed buffer is a warning GTK gives.
#
# **Two recorded gaps, not a broken fixture.** Under `--rc` both programs
# release the buffer while an iterator still points into it, because a GTK
# iterator does not count its buffer:
#
#   lifetime (rc)  the buffer is released at its last use. Releasing foreign
#                  handles at block end instead is what closes it; until then
#                  this arm is expected to FAIL.
#   escape (rc)    the iterator is returned out of the block that owns the
#                  buffer, which no release placement fixes. Expected to FAIL
#                  for as long as GTK's contract is that the caller keeps the
#                  buffer alive.
#
# Either arm passing fails this script: the gap closed, or the check went
# blind, and whichever it was, the expectation here has to change with it.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-iter-lifetime"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-iter-lifetime"
if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-iter-lifetime: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-iter-lifetime: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-iter-lifetime: no Gtk-4.0.gir"
  exit 0
fi

run() {
  env GSK_RENDERER=cairo G_DEBUG=fatal-warnings \
    timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$1/linux-gnu-x86_64/$1" 2>/dev/null | tr '\n' ' ' || true
}
# `check <product> <expected log>`: plain must print it; `--rc` must not.
check() {
  log=$(run "$1")
  echo "$1 ($mode): $log"
  if [ "$mode" = plain ] && [ "$log" != "$2" ]; then
    echo "FAILED gtk-iter-lifetime: $1 (plain) expected $2" >&2
    exit 1
  fi
  if [ "$mode" = rc ] && [ "$log" = "$2" ]; then
    echo "FAILED gtk-iter-lifetime: $1 (rc) passes, and it is a recorded gap -- it closed, or the check went blind; change its expectation here (see the header)" >&2
    exit 1
  fi
}
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  # shellcheck disable=SC2086
  "$nts" build "$source/escape/tsconfig.json" --out "$out/$mode" $flag
  for product in lifetime lifetime-llvm; do check "$product" "lifetime hello world 6 11 "; done
  for product in escape escape-llvm; do check "$product" "escape 6 119 "; done
done
echo "iterators outlive their buffers when nothing releases it, and both --rc gaps are still the recorded ones: OK"
