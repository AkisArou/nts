#!/bin/sh
# Regenerates `types/stat.d.ts`. Nothing about this binding is hand-written:
# `struct stat` is 144 bytes, sixteen members, three of them a nested
# `struct timespec`, and several 64-bit -- which is more than anyone should
# transcribe correctly, and exactly the size at which a generator earns its
# keep.
#
# `struct timespec` is not asked for. It is stored inline in `stat`, so its
# layout is part of `stat`'s, and `nts bind-c` pulls it in.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
"${NTS_BIN:-$root/target/release/nts}" bind-c \
  --module c:stat --header sys/stat.h --define _GNU_SOURCE \
  --record stat --alias stat=Stat --alias timespec=TimeSpec \
  --fn stat --no-escape stat:file --no-escape stat:buf \
  --out "$root/examples/interop/native-stat/types/stat.d.ts"
