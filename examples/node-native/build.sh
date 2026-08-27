#!/usr/bin/env bash
# Build an example into a native binary: emit C, then link it against the
# native layer and libuv. No engine, and nothing else.
#
#   examples/node-native/build.sh examples/node-fs demo.c out/fsdemo
set -euo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
example="${1:?example directory}"
driver="${2:?driver .c}"
out="${3:?output binary}"
work="$(mktemp -d)"
NTS_TSGO="${NTS_TSGO:-$R/target/tsgo}" "$R/target/debug/nts" emit-c "$example/tsconfig.json" --out "$work" >/dev/null
# GAP: the C backend emits the TypeScript export name as the C symbol, so
# `basename` and `dirname` collide with libc's. Namespacing belongs in the
# backend; until it is there, the same rename is applied here so the collision
# is worked around rather than hidden.
NS="-Dbasename=nts_path_basename -Ddirname=nts_path_dirname"
clang -std=c11 -O2 -D_GNU_SOURCE $NS \
  -I"$work" -I"$R/examples/node-native" \
  -include "$R/examples/node-native/nts_node.h" \
  -o "$out" \
  "$driver" "$work/program.c" "$work/nts_runtime.c" "$R/examples/node-native/nts_node.c" \
  -luv -lm
echo "$out: $(stat -c%s "$out") bytes"
