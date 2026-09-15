#!/bin/sh
# Regenerates `types/poll.d.ts` from <poll.h>. This example's ABI is **not**
# hand-written: the struct, its members and the prototype all come from the
# header, through the same clang the witness compares against.
#
# The one thing the header does not state is `--no-escape poll:fds` -- that
# `poll` reads its array during the call and keeps no address into it. That is
# author knowledge; without it the compiler refuses `local<PollFd>()` as an
# escape, correctly, and `nts bind-c` will not infer it from a C type.
set -eu
# The output path is an argument so `build.sh` can regenerate into a scratch
# file and compare: a generated file nothing re-derives is asserted, not
# checked.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/examples/interop/native-poll/types/poll.d.ts"}
"${NTS_BIN:-$root/target/release/nts}" bind-c \
  --module c:poll --header poll.h \
  --record pollfd --alias pollfd=PollFd \
  --fn poll --no-escape poll:fds \
  --out "$out"
