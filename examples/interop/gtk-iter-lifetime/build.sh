#!/bin/sh
# A buffer whose last use precedes its iterators' (src/main.ts), and an
# iterator that escapes its buffer's block (escape/src/main.ts), each built as
# a C and an LLVM product, plain and under reference counting, and run with
# GTK's warnings fatal: an iterator into a freed buffer is a warning GTK gives.
#
# **One gap closed and one recorded, and the two arms differ in one thing.** A
# GTK iterator does not count its buffer, so nothing in the IR says the iterator
# depends on it:
#
#   lifetime (rc)  **now passes.** The buffer was released at its last *read*,
#                  before the iterators were used. A foreign counted handle
#                  defined outside every cycle is now live until the function
#                  returns, so its release lands there. A regression here is
#                  that release moving back to a last use.
#   escape (rc)    the iterator is returned out of the function that owns the
#                  buffer, which no release placement fixes. Expected to FAIL
#                  for as long as GTK's contract is that the caller keeps the
#                  buffer alive -- and it is the arm that keeps the sentence
#                  above honest, since a fix that merely moved the release later
#                  would pass `lifetime` and this one too.
#
# `escape` passing fails this script: the gap closed, or the check went blind,
# and whichever it was, the expectation here has to change with it.
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
# `check <product> <expected log> <same|differs>`: plain must always print it,
# and the third argument says what `--rc` must do. Spelled per arm rather than
# per mode, because the two arms no longer answer the same way and a fixture
# whose expectation is a mode is a fixture that cannot record one gap closing.
check() {
  log=$(run "$1")
  echo "$1 ($mode): $log"
  if [ "$mode" = plain ] && [ "$log" != "$2" ]; then
    echo "FAILED gtk-iter-lifetime: $1 (plain) expected $2" >&2
    exit 1
  fi
  [ "$mode" = rc ] || return 0
  case $3 in
    same)
      [ "$log" = "$2" ] && return 0
      echo "FAILED gtk-iter-lifetime: $1 (rc) expected $2 -- a foreign handle is being released before an iterator into it, which block-end release closed" >&2
      exit 1
      ;;
    *)
      [ "$log" != "$2" ] && return 0
      echo "FAILED gtk-iter-lifetime: $1 (rc) passes, and it is a recorded gap -- it closed, or the check went blind; change its expectation here (see the header)" >&2
      exit 1
      ;;
  esac
}
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  # shellcheck disable=SC2086
  "$nts" build "$source/escape/tsconfig.json" --out "$out/$mode" $flag
  for product in lifetime lifetime-llvm; do check "$product" "lifetime hello world 6 11 " same; done
  for product in escape escape-llvm; do check "$product" "escape 6 119 " differs; done
done
echo "a buffer outlives its iterators where a name holds it, and the escaping gap is still the recorded one: OK"
