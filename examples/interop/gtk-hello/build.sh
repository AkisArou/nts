#!/bin/sh
# Build the GTK4 program and run it, then run it again with the handler left
# unconnected and require that arm to fail its check.
#
# **The control is what makes `clicks=2` mean something.** The program clicks
# the button itself, through the signal system; a count of 2 alone cannot tell
# a handler that ran from a check that read a constant. With HELLO_UNCONNECTED
# the clicks still happen and nothing counts them.
#
# No display is needed: `xvfb-run` supplies one, and the cairo renderer keeps
# Mesa's DRI3 complaints about Xvfb out of the output. `fatal-criticals` turns
# any GTK critical -- a wrong cast, a NULL where a widget goes -- into an abort
# rather than a line nobody reads.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-hello"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-hello"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-hello: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-hello: no xvfb-run on PATH"
  exit 0
fi

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out"
program="$out/hello/linux-gnu-x86_64/hello"

run() {
  env GSK_RENDERER=cairo G_DEBUG=fatal-criticals "$@" xvfb-run -a "$program" 2>&1 |
    grep '^clicks=' || true
}

connected=$(run)
unconnected=$(run HELLO_UNCONNECTED=1)
echo "connected:   $connected"
echo "unconnected: $unconnected"
if [ "$connected" != "clicks=2 status=0" ]; then
  echo "FAILED gtk-hello: expected clicks=2 status=0" >&2
  exit 1
fi
if [ "$unconnected" = "$connected" ]; then
  echo "FAILED gtk-hello: the unconnected control answered the same, so the check reads nothing" >&2
  exit 1
fi
echo "GTK4 application, signal handler, and quit: OK"
