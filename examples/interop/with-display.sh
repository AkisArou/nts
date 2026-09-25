#!/bin/sh
# Run a program against an X display of its own, and know the display is up
# before the program starts.
#
# # Why this exists rather than `xvfb-run -a`
#
# Because `xvfb-run` decides the server is ready by **sleeping for three
# seconds**, and Xvfb will tell you instead if you ask it. `Xvfb -displayfd <fd>`
# picks a free display itself, binds it, and writes the number to that descriptor
# *once it is listening* -- so the number arriving is the readiness signal, and
# there is nothing to wait a guessed interval for.
#
# The property, measured on this machine with nothing else holding a display:
#
#     xvfb-run -a -w 0 xdpyinfo    unable to open display ":99"   (3 of 3)
#     with-display.sh  xdpyinfo    name of display: :0            (3 of 3)
#
# `-w 0` removes the sleep and changes nothing else, which is the whole of what
# this replaces: a wait that is a guess against a wait that is a signal. Xvfb
# comes up in 106 ms here, so three seconds is normally plenty -- and a fixed
# wait cannot tell "not yet" from "never", so when it is not plenty the failure
# arrives as the *program's*: `Gtk-WARNING: Failed to open display` and an empty
# `log:` line, which reads exactly like a program that ran and printed nothing.
#
# **What is not claimed.** On 2026-09-25 all six gtk-* scripts failed that way
# for about two hours and then passed again, and this helper is not known to be
# what fixes that: the cause was never reproduced. My first diagnosis -- a stuck
# server holding a display with no lock file, which `xvfb-run -a`'s
# `find_free_servernum` cannot see -- was **wrong**, and worse, the state I
# described was one I had created myself with an `rm` a few minutes earlier while
# probing. A real squatter makes the client *succeed*, because it connects to the
# squatter. So this change removes two places where `xvfb-run` infers something
# the system will tell it, and it comes with no reproduction of the failure that
# prompted it.
#
# `xvfb-run`'s own "new style" path does use `-displayfd`, and gets it wrong in a
# way worth not repeating: it backgrounds the server *inside* a command
# substitution and echoes the pid to a file, so the substitution captures nothing
# and the number is lost. That path is unreachable from `-a` anyway.
#
# # Usage
#
#     examples/interop/with-display.sh ./program [args...]
#     env GSK_RENDERER=cairo examples/interop/with-display.sh ./program
#
# The environment passes through, so the callers keep setting `GSK_RENDERER` and
# `G_DEBUG` themselves. Exits with the program's status; the server is killed on
# every exit path, including the `timeout` the callers wrap this in.
set -eu

if [ $# -lt 1 ]; then
  echo "with-display.sh: no command to run" >&2
  exit 2
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "with-display.sh: no Xvfb on PATH" >&2
  exit 2
fi

work=$(mktemp -d)
number="$work/display"
: > "$number"
# `3>` rather than `-displayfd 1`: the program's own stdout is what the callers
# capture and compare, and the server must not write a line into it.
Xvfb -displayfd 3 -screen 0 1280x1024x24 -nolisten tcp 3>"$number" \
  >"$work/log" 2>&1 &
server=$!
# The server dies on every exit path -- including the one `timeout` takes, which
# is why TERM and INT are here as well as EXIT.
cleanup() {
  kill "$server" 2>/dev/null || true
  wait "$server" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

waited=0
while [ ! -s "$number" ]; do
  # **Both ways of not coming up**, because a wait that only has a timeout
  # reports "slow" for a server that has already exited, and the log is where
  # the reason is.
  if ! kill -0 "$server" 2>/dev/null; then
    echo "with-display.sh: Xvfb exited before it had a display" >&2
    sed 's/^/  /' "$work/log" >&2 || true
    exit 1
  fi
  waited=$((waited + 1))
  if [ "$waited" -gt 200 ]; then
    echo "with-display.sh: Xvfb did not report a display within 20s" >&2
    sed 's/^/  /' "$work/log" >&2 || true
    exit 1
  fi
  sleep 0.1
done

DISPLAY=":$(tr -d '[:space:]' < "$number")"
export DISPLAY
"$@"
