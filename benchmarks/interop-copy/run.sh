#!/bin/sh
# Build item 3: the interop copy measurement.
#
# Prints nanoseconds per operation by default and bytes per operation under
# NTS_BENCH_ALLOC=1. Skips loudly without a JDK.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
nts_jvm_flags=$(cat "$root/runtime/jvm/test-vm-flags.txt")
nts_jdk_flags=$(sed 's/^/-J/' "$root/runtime/jvm/test-vm-flags.txt")

if ! command -v javac > /dev/null 2>&1; then
  echo "SKIP interop-copy: no javac on PATH"
  exit 0
fi

out="$here/target"
rm -rf "$out"; mkdir -p "$out"
javac $nts_jdk_flags --release 8 -Xlint:all,-options -d "$out" \
  "$root/benchmarks/common/Bench.java" "$here/Copies.java"
java $nts_jvm_flags -cp "$out" Copies "$@"
