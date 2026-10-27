#!/bin/sh
# Does the instance forwarder cost anything? Skips loudly without a JDK.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
nts_jvm_flags=$(cat "$root/runtime/jvm/test-vm-flags.txt")
nts_jdk_flags=$(sed 's/^/-J/' "$root/runtime/jvm/test-vm-flags.txt")
command -v javac > /dev/null 2>&1 || { echo "SKIP interop-facade: no javac"; exit 0; }
out="$here/target"; rm -rf "$out"; mkdir -p "$out"
javac $nts_jdk_flags --release 8 -Xlint:all,-options -d "$out" "$root/benchmarks/common/Bench.java" "$here/Facade.java"
java $nts_jvm_flags -cp "$out" Facade "$@"
