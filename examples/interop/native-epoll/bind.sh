#!/bin/sh
# Regenerates `src/constants.ts`. The command is the record of where those
# numbers came from, which is why it is a file and not a line in a README.
#
# `EPOLLIN` is renamed because it is an **enumerator**, not a macro: program.c
# includes <sys/epoll.h>, and nts can release its own names from a macro but
# not from a declaration. `nts bind-c` refuses that name and says so.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
"${NTS_BIN:-$root/target/release/nts}" bind-c \
  --module c:epoll --header sys/epoll.h \
  --const EPOLLIN:c_uint32 --alias EPOLLIN=READABLE \
  --const EPOLL_CTL_ADD \
  --constants-out "$root/examples/interop/native-epoll/src/constants.ts"
