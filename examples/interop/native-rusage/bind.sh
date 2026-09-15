#!/bin/sh
# Regenerates `types/rusage.d.ts` from <sys/resource.h>. Nothing about this
# example's ABI is hand-written, and the part worth regenerating is the part a
# person would get wrong: `struct rusage` is fourteen C11 anonymous unions, and
# the flat description below is derived by reaching through them rather than
# transcribed.
#
# The one thing the header does not state is `--no-escape getrusage:usage` --
# that `getrusage` fills the struct during the call and keeps no address into
# it. That is author knowledge; `nts bind-c` will not infer it from a C type.
#
# `RUSAGE_SELF` is deliberately absent. It is an enumeration constant rather
# than a macro, so `--const` refuses it: a global of that name would collide
# with the header's own declaration in the same translation unit.
set -eu
# The output path is an argument so `build.sh` can regenerate into a scratch
# file and compare: a generated file nothing re-derives is asserted, not
# checked.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/examples/interop/native-rusage/types/rusage.d.ts"}
"${NTS_BIN:-$root/target/release/nts}" bind-c \
  --module c:sys/resource --header sys/resource.h \
  --record rusage --record timeval \
  --alias rusage=Rusage --alias timeval=Timeval \
  --fn getrusage --no-escape getrusage:usage \
  --out "$out"
